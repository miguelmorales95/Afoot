// Newsletter ingestion: take an inbound email (from the webhook or the IMAP
// poller), match it to a venue, extract events from the body, and store them
// tagged source="newsletter". The extractor is source-agnostic — the same
// prompt that reads a website reads a newsletter.

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
  status: "processed" | "unmatched" | "error" | "duplicate";
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

interface VenueLite {
  id: string;
  name: string;
  website: string | null;
}

async function matchVenue(
  email: InboundEmail,
  bodyText: string,
): Promise<{ venue: VenueLite; how: string } | null> {
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
    return { venue: venueById.get(byAddr.venue_id)!, how: "sender address" };

  // 2. Sender-domain mapping.
  if (dom) {
    const byDom = activeSources.find((s) => s.from_domain === dom);
    if (byDom?.venue_id && venueById.has(byDom.venue_id))
      return { venue: venueById.get(byDom.venue_id)!, how: "sender domain (mapped)" };
  }

  // 3. Sender domain == a venue's own website domain.
  if (dom && venueByDomain.has(dom))
    return { venue: venueByDomain.get(dom)!, how: "sender domain == website" };

  // 4. A link in the body points at a known venue's website domain.
  if (email.html) {
    for (const d of linkDomains(email.html)) {
      if (venueByDomain.has(d)) return { venue: venueByDomain.get(d)!, how: "body link domain" };
      const src = activeSources.find((s) => s.from_domain === d);
      if (src?.venue_id && venueById.has(src.venue_id))
        return { venue: venueById.get(src.venue_id)!, how: "body link (mapped)" };
    }
  }

  // 5. Keyword mapping (name/subject/body contains a configured keyword).
  const hay = `${email.fromName ?? ""} ${email.subject ?? ""} ${bodyText}`.toLowerCase();
  const byKw = activeSources.find(
    (s) => s.match_keyword && hay.includes(s.match_keyword.toLowerCase()),
  );
  if (byKw?.venue_id && venueById.has(byKw.venue_id))
    return { venue: venueById.get(byKw.venue_id)!, how: "keyword" };

  return null;
}

export async function processInboundEmail(
  email: InboundEmail,
  log: (s: string) => void = () => {},
): Promise<ProcessResult> {
  const bodyText = (email.text?.trim() || (email.html ? htmlToText(email.html) : "")).slice(0, 24000);

  // Idempotency: skip if we've already logged this Message-ID.
  if (email.messageId) {
    const { data: existing } = await supabase
      .from("inbound_emails")
      .select("id")
      .eq("message_id", email.messageId)
      .maybeSingle();
    if (existing) {
      log(`  duplicate message ${email.messageId}, skipping`);
      return { status: "duplicate" };
    }
  }

  const match = await matchVenue(email, bodyText);

  // Log the inbound email (for review / audit).
  const { data: logRow } = await supabase
    .from("inbound_emails")
    .insert({
      message_id: email.messageId ?? null,
      from_address: email.from,
      from_name: email.fromName ?? null,
      to_address: email.to ?? null,
      subject: email.subject ?? null,
      received_at: email.receivedAt ?? new Date().toISOString(),
      body_text: bodyText,
      matched_venue_id: match?.venue.id ?? null,
      status: match ? "new" : "unmatched",
    })
    .select("id")
    .single();

  if (!match) {
    log(`  unmatched: ${email.from} ("${email.subject ?? ""}")`);
    return { status: "unmatched", note: `no venue match for ${email.from}` };
  }

  log(`> ${match.venue.name} — newsletter from ${email.from} (${match.how})`);

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

    if (logRow) {
      await supabase
        .from("inbound_emails")
        .update({ status: "processed", events_found: events.length })
        .eq("id", logRow.id);
    }

    log(`  -> ${occurrences} occurrence(s) from newsletter`);
    return { status: "processed", venue: match.venue.name, events: events.length, occurrences };
  } catch (err) {
    const note = (err as Error).message;
    if (logRow)
      await supabase.from("inbound_emails").update({ status: "error", note }).eq("id", logRow.id);
    log(`  ! error: ${note}`);
    return { status: "error", note };
  }
}
