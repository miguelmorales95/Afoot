// Newsletter ingestion: take an inbound email (from the webhook or the IMAP
// poller), match it to a venue, extract events from the body, and store them
// tagged source="newsletter". The extractor is source-agnostic — the same
// prompt that reads a website reads a newsletter.
//
// The webhook only queues (queueInboundEmail): Vercel has no AI key and short time
// limits. The daily GitHub Actions job reads the queue (processQueuedEmails). The
// IMAP poller does both in one go (processInboundEmail).

import { supabase } from "./supabase";
import { extractEvents } from "./extract";
import { storeExtractedEvents, todayISODate } from "./ingest";
import { htmlToText } from "./scrape";
import { registrableDomain } from "./domain";

export interface InboundEmail {
  messageId?: string | null;
  from: string; // sender address
  fromName?: string | null;
  to?: string | null;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  receivedAt?: string | null; // ISO
}

export interface ProcessResult {
  status: "processed" | "unmatched" | "error" | "duplicate" | "queued" | "needs_confirm";
  venue?: string;
  events?: number;
  occurrences?: number;
  note?: string;
}

function emailDomain(addr: string): string | null {
  const m = addr.toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1].replace(/^www\./, "") : null;
}

/** Distinct registrable domains linked from an HTML body. */
function linkDomains(html: string): string[] {
  const set = new Set<string>();
  const re = /href="(https?:\/\/[^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const d = registrableDomain(m[1]);
    if (d) set.add(d);
  }
  return [...set];
}

/** "Please confirm your subscription" mail: the founder clicks its link once in /admin. */
export function confirmLinks(email: { subject?: string | null; html?: string | null; text?: string | null }): string[] {
  const subject = email.subject ?? "";
  if (!/confirm|verify|activate|double.?opt|one more step|almost (done|there)/i.test(subject)) return [];
  const body = `${email.html ?? ""} ${email.text ?? ""}`;
  const links = new Set<string>();
  for (const m of body.matchAll(/https?:\/\/[^\s"'<>)]+/gi)) {
    if (/confirm|verify|optin|opt-in|subscribe|activate/i.test(m[0])) links.add(m[0].replace(/&amp;/g, "&"));
  }
  return [...links].slice(0, 3);
}

/** Lowercase letters and digits only, for comparing names. */
const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

interface VenueLite {
  id: string;
  name: string;
  website: string | null;
}

async function matchVenue(
  email: InboundEmail,
  bodyText: string,
): Promise<{ venue: VenueLite; how: string; learn: boolean } | null> {
  const from = email.from.toLowerCase();
  const dom = emailDomain(from);

  const { data: venues } = await supabase.from("venues").select("id, name, website");
  const { data: sources } = await supabase
    .from("newsletter_sources")
    .select("venue_id, from_address, from_domain, match_keyword, active");

  const venueById = new Map<string, VenueLite>();
  const venueByDomain = new Map<string, VenueLite>();
  for (const v of (venues ?? []) as VenueLite[]) {
    venueById.set(v.id, v);
    const d = v.website ? registrableDomain(v.website) : null;
    if (d) venueByDomain.set(d, v);
  }

  const activeSources = (sources ?? []).filter((s) => s.active !== false);

  // 1. Exact sender address mapping.
  const byAddr = activeSources.find(
    (s) => s.from_address && s.from_address.toLowerCase() === from,
  );
  if (byAddr?.venue_id && venueById.has(byAddr.venue_id))
    return { venue: venueById.get(byAddr.venue_id)!, how: "sender address", learn: false };

  // 2. Sender-domain mapping.
  if (dom) {
    const byDom = activeSources.find((s) => s.from_domain === dom);
    if (byDom?.venue_id && venueById.has(byDom.venue_id))
      return { venue: venueById.get(byDom.venue_id)!, how: "sender domain (mapped)", learn: false };
  }

  // 3. Sender domain == a venue's own website domain.
  if (dom && venueByDomain.has(dom))
    return { venue: venueByDomain.get(dom)!, how: "sender domain == website", learn: true };

  // 4. The sender's name is a venue's name ("Lyric Hyperion <news@mail.beehiiv.com>").
  //    Names shorter than 5 letters are too likely to collide, so they're skipped.
  const sender = squash(email.fromName ?? "");
  if (sender.length >= 5) {
    const named = [...venueById.values()]
      .filter((v) => squash(v.name).length >= 5 && (sender.includes(squash(v.name)) || squash(v.name).includes(sender)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (named) return { venue: named, how: "sender name", learn: false };
  }

  // 5. A link in the body points at a known venue's website domain.
  if (email.html) {
    for (const d of linkDomains(email.html)) {
      if (venueByDomain.has(d)) return { venue: venueByDomain.get(d)!, how: "body link domain", learn: false };
      const src = activeSources.find((s) => s.from_domain === d);
      if (src?.venue_id && venueById.has(src.venue_id))
        return { venue: venueById.get(src.venue_id)!, how: "body link (mapped)", learn: false };
    }
  }

  // 6. Keyword mapping (name/subject/body contains a configured keyword).
  const hay = `${email.fromName ?? ""} ${email.subject ?? ""} ${bodyText}`.toLowerCase();
  const byKw = activeSources.find(
    (s) => s.match_keyword && hay.includes(s.match_keyword.toLowerCase()),
  );
  if (byKw?.venue_id && venueById.has(byKw.venue_id))
    return { venue: venueById.get(byKw.venue_id)!, how: "keyword", learn: false };

  return null;
}

/** Remember a sender address for a venue, so its next newsletter matches exactly. */
export async function learnSender(venueId: string, venueName: string, address: string) {
  const from_address = address.toLowerCase();
  const { data: existing } = await supabase.from("newsletter_sources").select("id").eq("from_address", from_address).maybeSingle();
  if (existing) return;
  await supabase.from("newsletter_sources").insert({ venue_id: venueId, from_address, label: `${venueName} newsletter`, active: true });
}

const bodyOf = (email: InboundEmail) =>
  (email.text?.trim() || (email.html ? htmlToText(email.html) : "")).slice(0, 24000);

/** Saves an inbound email for the daily job (or returns "duplicate" for one already saved). */
export async function queueInboundEmail(email: InboundEmail): Promise<ProcessResult & { id?: string }> {
  if (email.messageId) {
    const { data: existing } = await supabase.from("inbound_emails").select("id").eq("message_id", email.messageId).maybeSingle();
    if (existing) return { status: "duplicate" };
  }
  const confirm = confirmLinks(email);
  // Postgres text can't hold NUL characters, which some mailing-list HTML contains.
  const nul = /\u0000/g;
  email = { ...email, text: email.text?.replace(nul, "") ?? null, html: email.html?.replace(nul, "") ?? null,
    subject: email.subject?.replace(nul, "") ?? null, fromName: email.fromName?.replace(nul, "") ?? null };
  const { data, error } = await supabase.from("inbound_emails").insert({
    message_id: email.messageId ?? null,
    from_address: email.from,
    from_name: email.fromName ?? null,
    to_address: email.to ?? null,
    subject: email.subject ?? null,
    received_at: email.receivedAt ?? new Date().toISOString(),
    body_text: bodyOf(email),
    body_html: email.html ? email.html.slice(0, 300_000) : null,
    status: confirm.length ? "needs_confirm" : "queued",
    note: confirm.length ? confirm.join("\n") : null,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { status: confirm.length ? "needs_confirm" : "queued", id: data.id };
}

interface InboundRow {
  id: string;
  from_address: string | null;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  matched_venue_id: string | null;
}

/** Matches one saved email to a venue and turns it into events. */
async function processRow(row: InboundRow, log: (s: string) => void): Promise<ProcessResult> {
  const email: InboundEmail = {
    from: row.from_address ?? "", fromName: row.from_name, subject: row.subject, text: row.body_text, html: row.body_html,
  };
  const bodyText = row.body_text ?? "";

  // An admin may already have picked the venue (/admin → Newsletters).
  let match: { venue: VenueLite; how: string; learn: boolean } | null = null;
  if (row.matched_venue_id) {
    const { data: v } = await supabase.from("venues").select("id, name, website").eq("id", row.matched_venue_id).maybeSingle();
    if (v) match = { venue: v as VenueLite, how: "assigned in /admin", learn: false };
  }
  match ??= await matchVenue(email, bodyText);

  if (!match) {
    await supabase.from("inbound_emails").update({ status: "unmatched" }).eq("id", row.id);
    log(`  unmatched: ${email.from} ("${email.subject ?? ""}")`);
    return { status: "unmatched", note: `no venue match for ${email.from}` };
  }

  log(`> ${match.venue.name} — newsletter from ${email.from} (${match.how})`);
  if (match.learn && email.from) await learnSender(match.venue.id, match.venue.name, email.from);

  try {
    const events = await extractEvents({
      venueName: match.venue.name,
      pageText: `Subject: ${email.subject ?? ""}\n\n${bodyText}`,
      sourceUrl: match.venue.website || email.from,
      today: todayISODate(),
    });
    log(`  extracted ${events.length} event(s)`);

    const occurrences = await storeExtractedEvents({
      venueId: match.venue.id,
      events,
      source: "newsletter",
      fallbackUrl: match.venue.website,
      log,
    });

    await supabase
      .from("inbound_emails")
      .update({ status: "processed", events_found: events.length, matched_venue_id: match.venue.id })
      .eq("id", row.id);

    log(`  -> ${occurrences} occurrence(s) from newsletter`);
    return { status: "processed", venue: match.venue.name, events: events.length, occurrences };
  } catch (err) {
    const note = (err as Error).message;
    await supabase.from("inbound_emails").update({ status: "error", note, matched_venue_id: match.venue.id }).eq("id", row.id);
    log(`  ! error: ${note}`);
    return { status: "error", note };
  }
}

const ROW_COLUMNS = "id, from_address, from_name, subject, body_text, body_html, matched_venue_id";

/** Saves an email and processes it right away (the IMAP poller, which has the AI key). */
export async function processInboundEmail(
  email: InboundEmail,
  log: (s: string) => void = () => {},
): Promise<ProcessResult> {
  const queued = await queueInboundEmail(email);
  if (queued.status !== "queued" || !queued.id) {
    log(queued.status === "duplicate" ? `  duplicate message ${email.messageId}, skipping` : `  confirmation email from ${email.from}: open /admin → Newsletters`);
    return queued;
  }
  const { data: row } = await supabase.from("inbound_emails").select(ROW_COLUMNS).eq("id", queued.id).single();
  return processRow(row as InboundRow, log);
}

/** Processes every queued email, oldest first (the daily job). */
export async function processQueuedEmails(log: (s: string) => void = console.log, limit = 100) {
  const { data: rows, error } = await supabase.from("inbound_emails").select(ROW_COLUMNS)
    .eq("status", "queued").order("received_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  const tally: Record<string, number> = {};
  for (const row of (rows ?? []) as InboundRow[]) {
    const r = await processRow(row, log);
    tally[r.status] = (tally[r.status] ?? 0) + 1;
  }
  return { emails: rows?.length ?? 0, ...tally };
}
