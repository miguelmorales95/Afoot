import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { simpleParser } from "mailparser";
import { queueInboundEmail, type InboundEmail } from "@/lib/newsletter";
import { supabase } from "@/lib/supabase";

// Inbound newsletter webhook. The Cloudflare Email Worker (docs/cloudflare-email-worker.js) posts
// each email here as raw MIME (Content-Type: message/rfc822). JSON or form posts from other
// providers (SendGrid Inbound Parse, Mailgun Routes, Postmark) work too. Protect it with a secret:
//   header x-inbound-secret: INBOUND_EMAIL_SECRET   (or ?secret=…)
// The email is only saved here; the daily GitHub Actions job reads its events
// (npm run newsletters -- --queue), because reading needs the AI key and more time than Vercel gives.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function pick(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

/** "Name <addr@x.com>" -> { name, address }. */
function parseFrom(raw: string | null): { name: string | null; address: string } {
  if (!raw) return { name: null, address: "" };
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, address: m[2].trim().toLowerCase() };
  return { name: null, address: raw.trim().toLowerCase() };
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  // Without a secret the webhook is open only in local development, like the cron route.
  if (!secret) return process.env.NODE_ENV !== "production";
  const provided = req.headers.get("x-inbound-secret") || req.nextUrl.searchParams.get("secret") || "";
  const a = Buffer.from(provided), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function fromMime(raw: Buffer): Promise<InboundEmail> {
  const parsed = await simpleParser(raw);
  const from = parsed.from?.value?.[0];
  return {
    messageId: parsed.messageId ?? null,
    from: from?.address?.toLowerCase() ?? "",
    fromName: from?.name || null,
    to: Array.isArray(parsed.to) ? parsed.to[0]?.text ?? null : parsed.to?.text ?? null,
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: typeof parsed.html === "string" ? parsed.html : null,
    // A malformed Date header parses to an invalid date: use the time it arrived instead.
    receivedAt: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : null,
  };
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let email: InboundEmail;
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("message/rfc822") || ct.includes("text/plain")) {
      email = await fromMime(Buffer.from(await req.arrayBuffer()));
    } else {
      let body: Record<string, unknown> = {};
      if (ct.includes("application/json")) {
        body = (await req.json()) as Record<string, unknown>;
      } else {
        const form = await req.formData();
        for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : v.name;
      }
      const from = parseFrom(pick(body, ["from", "From", "sender", "Sender"]));
      email = {
        messageId: pick(body, ["messageId", "Message-Id", "message-id", "MessageID", "MessageId"]),
        from: from.address,
        fromName: pick(body, ["fromName", "FromName", "fromname"]) || from.name,
        to: pick(body, ["to", "To", "recipient", "Recipient"]),
        subject: pick(body, ["subject", "Subject"]),
        text: pick(body, ["text", "body-plain", "TextBody", "plain", "stripped-text"]),
        html: pick(body, ["html", "body-html", "HtmlBody", "stripped-html"]),
        receivedAt: pick(body, ["receivedAt", "Date", "date", "timestamp"]),
      };
    }
  } catch (err) {
    console.error("inbound-email parse error:", (err as Error).message);
    await saveFailure(null, `couldn't read the email: ${(err as Error).message}`);
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (!email.from) return NextResponse.json({ error: "missing sender" }, { status: 400 });

  try {
    const result = await queueInboundEmail(email);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (err) {
    console.error("inbound-email error:", (err as Error).message);
    await saveFailure(email, (err as Error).message);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

/** Records a failed email (who, what, why) for /admin → Newsletters. The worker still forwards the
 *  email itself to FORWARD_TO, so nothing is lost; this says why it didn't go through. */
async function saveFailure(email: InboundEmail | null, why: string) {
  try {
    await supabase.from("inbound_emails").insert({
      from_address: email?.from || "unknown", from_name: email?.fromName?.slice(0, 200) ?? null,
      subject: email?.subject?.slice(0, 500) ?? null, received_at: new Date().toISOString(),
      status: "error", note: why.slice(0, 500),
    });
  } catch { /* nothing more to do: the worker forwards the email */ }
}
