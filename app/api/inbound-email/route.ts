import { NextRequest, NextResponse } from "next/server";
import { processInboundEmail, type InboundEmail } from "@/lib/newsletter";

// Inbound newsletter webhook. Point your email provider's inbound/parse hook
// here (Cloudflare Email Worker, SendGrid Inbound Parse, Mailgun Routes,
// Postmark inbound, or anything that POSTs JSON). Protect it with a secret:
//   POST /api/inbound-email?secret=YOUR_SECRET
// or header:  x-inbound-secret: YOUR_SECRET
//
// Accepts JSON or multipart/form-data and normalizes the common provider shapes.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const provided =
    req.nextUrl.searchParams.get("secret") || req.headers.get("x-inbound-secret");
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Gather fields from JSON or form-data.
  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      body = (await req.json()) as Record<string, unknown>;
    } else {
      const form = await req.formData();
      for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : v.name;
    }
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const from = parseFrom(
    pick(body, ["from", "From", "sender", "Sender"]),
  );
  const email: InboundEmail = {
    messageId: pick(body, ["messageId", "Message-Id", "message-id", "MessageID", "MessageId"]),
    from: from.address,
    fromName: pick(body, ["fromName", "FromName", "fromname"]) || from.name,
    to: pick(body, ["to", "To", "recipient", "Recipient"]),
    subject: pick(body, ["subject", "Subject"]),
    text: pick(body, ["text", "body-plain", "TextBody", "plain", "stripped-text"]),
    html: pick(body, ["html", "body-html", "HtmlBody", "stripped-html"]),
    receivedAt: pick(body, ["receivedAt", "Date", "date", "timestamp"]),
  };

  if (!email.from) {
    return NextResponse.json({ error: "missing sender" }, { status: 400 });
  }

  try {
    const logs: string[] = [];
    const result = await processInboundEmail(email, (s) => logs.push(s));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("inbound-email error:", (err as Error).message);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
