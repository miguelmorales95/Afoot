// Core ingest logic, shared by the CLI (scripts/ingest.ts), the scheduled cron
// route, and the newsletter pipeline (which reuses storeExtractedEvents).

import { supabase } from "./supabase";
import { fetchPageText, fetchRenderedText } from "./scrape";
import { extractEvents } from "./extract";
import type { ExtractedEvent, Venue } from "./types";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function todayISODate(tz = "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Future dates of an event that aren't in `listed` (epoch ms): those with RSVPs or chat
 *  messages to keep (as cancelled), and the rest to delete. */
async function staleOccurrences(eventId: string, listed: number[]) {
  const { data } = await supabase
    .from("event_occurrences")
    .select("id, starts_at")
    .eq("event_id", eventId)
    .gte("starts_at", new Date().toISOString());
  const stale = (data ?? []).filter((o) => !listed.includes(Date.parse(o.starts_at))).map((o) => o.id as string);
  if (!stale.length) return { keep: [] as string[], remove: [] as string[] };
  const [going, chat] = await Promise.all([
    supabase.from("rsvps").select("occurrence_id").in("occurrence_id", stale),
    supabase.from("messages").select("occurrence_id").in("occurrence_id", stale),
  ]);
  // If either lookup fails, delete nothing: keeping a stale date is better than losing a chat.
  if (going.error || chat.error) return { keep: stale, remove: [] as string[] };
  const used = new Set([...(going.data ?? []), ...(chat.data ?? [])].map((r) => r.occurrence_id as string));
  return { keep: stale.filter((id) => used.has(id)), remove: stale.filter((id) => !used.has(id)) };
}

/**
 * Upsert a batch of extracted events (and their occurrences) for one venue.
 * Idempotent: events keyed by dedupe_key; future occurrences updated in place, and dates the
 * source dropped removed (or marked cancelled if anyone RSVP'd or chatted).
 * Shared by website ingestion and newsletter ingestion.
 */
export async function storeExtractedEvents(opts: {
  venueId: string;
  events: ExtractedEvent[];
  source: "website" | "newsletter" | "manual";
  fallbackUrl?: string | null;
  log?: (s: string) => void;
}): Promise<number> {
  const log = opts.log ?? (() => {});
  let occurrenceCount = 0;

  for (const ev of opts.events) {
    const dedupeKey = `${opts.venueId}:${slugify(ev.title)}`;

    const { data: eventRow, error: evErr } = await supabase
      .from("events")
      .upsert(
        {
          venue_id: opts.venueId,
          title: ev.title,
          description: ev.description,
          category: ev.category,
          price: ev.price,
          url: ev.url || opts.fallbackUrl || null,
          recurrence_description: ev.recurrence_description,
          is_recurring: !!ev.is_recurring,
          tags: ev.tags ?? [],
          source: opts.source,
          dedupe_key: dedupeKey,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      )
      .select("id")
      .single();

    if (evErr || !eventRow) {
      log(`  ! upsert failed for "${ev.title}": ${evErr?.message}`);
      continue;
    }

    const rows = ev.occurrences
      .map((o) => ({ event_id: eventRow.id, starts_at: o.start, ends_at: o.end }))
      .filter((r) => {
        const t = Date.parse(r.starts_at);
        return !Number.isNaN(t) && t >= Date.now() - 12 * 3600 * 1000;
      });

    // Dates the page no longer lists fall off, but never by deleting a date people said they're
    // going to or chatted about: those are marked cancelled instead (deleting would take their
    // RSVPs and messages with it). Dates still listed are updated in place, keeping their id.
    const dropped = await staleOccurrences(eventRow.id, rows.map((r) => Date.parse(r.starts_at)));
    if (dropped.keep.length) {
      await supabase.from("event_occurrences").update({ cancelled: true }).in("id", dropped.keep);
      log(`  ~ "${ev.title}": ${dropped.keep.length} dropped date(s) have RSVPs or chat; marked cancelled`);
    }
    if (dropped.remove.length) await supabase.from("event_occurrences").delete().in("id", dropped.remove);

    if (rows.length) {
      const { error: occErr } = await supabase
        .from("event_occurrences")
        .upsert(rows, { onConflict: "event_id,starts_at" });
      if (occErr) log(`  ! occurrences for "${ev.title}": ${occErr.message}`);
      else occurrenceCount += rows.length;
    }
  }

  return occurrenceCount;
}

export interface VenueResult {
  venue: string;
  events: number;
  occurrences: number;
  skipped?: string;
}

/** Print what the extractor found, in LA local time, so recurrence can be eyeballed. */
function logPreview(events: ExtractedEvent[], log: (s: string) => void) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  for (const ev of events) {
    const rule = ev.is_recurring ? ` [recurring: ${ev.recurrence_description ?? "no rule given"}]` : "";
    log(`  • ${ev.title} (${ev.category}${ev.price ? `, ${ev.price}` : ""})${rule}`);
    for (const o of ev.occurrences) {
      const t = Date.parse(o.start);
      log(`      ${Number.isNaN(t) ? `?? unparseable "${o.start}"` : fmt.format(t)}`);
    }
  }
}

export async function ingestVenue(
  venue: Venue,
  log = console.log,
  opts: { dryRun?: boolean } = {},
): Promise<VenueResult> {
  const url = venue.events_url || venue.website;
  if (!url) return { venue: venue.name, events: 0, occurrences: 0, skipped: "no URL" };

  log(`> ${venue.name} (${url})`);
  let page = await fetchPageText(url);

  // Headless fallback for JS-rendered sites (e.g. Zebulon). Triggered when the
  // venue is flagged `render`, or a plain fetch came back thin. Disable with
  // ENABLE_RENDER=0.
  const renderEnabled = process.env.ENABLE_RENDER !== "0";
  const thin = !page.ok || page.text.length < 400;
  if (renderEnabled && (venue.render || thin)) {
    log(`  rendering with headless browser…`);
    const rendered = await fetchRenderedText(url);
    if (rendered.ok && rendered.text.length > page.text.length) page = rendered;
  }

  if (!page.ok || page.text.length < 200) {
    const skipped = `thin/failed fetch (status ${page.status}, ${page.text.length} chars)`;
    log(`  ${skipped}`);
    return { venue: venue.name, events: 0, occurrences: 0, skipped };
  }

  const events = await extractEvents({
    venueName: venue.name,
    pageText: page.text,
    sourceUrl: url,
    today: todayISODate(),
  });
  log(`  extracted ${events.length} event(s)`);

  if (opts.dryRun) {
    // Preview only: nothing is written to the database.
    logPreview(events, log);
    const occ = events.reduce((n, e) => n + e.occurrences.length, 0);
    return { venue: venue.name, events: events.length, occurrences: occ };
  }

  const occurrenceCount = await storeExtractedEvents({
    venueId: venue.id,
    events,
    source: "website",
    fallbackUrl: url,
    log,
  });

  await supabase
    .from("venues")
    .update({ last_ingested_at: new Date().toISOString() })
    .eq("id", venue.id);

  log(`  -> ${occurrenceCount} upcoming occurrence(s)`);
  return { venue: venue.name, events: events.length, occurrences: occurrenceCount };
}

export async function ingestAll(
  opts: { onlySlug?: string; dryRun?: boolean; log?: (s: string) => void; budgetMs?: number } = {},
): Promise<VenueResult[]> {
  const started = Date.now();
  const log = opts.log ?? console.log;

  // "manual" venues hold hand-researched one-off events (npm run import:csv), not a
  // calendar page worth scraping every day.
  let query = supabase.from("venues").select("*").eq("active", true).neq("source", "manual");
  if (opts.onlySlug) query = query.eq("slug", opts.onlySlug);
  // Longest since last tried first, so a run that stops at its time budget picks up where the
  // last one left off instead of redoing the same venues.
  query = query.order("last_ingested_at", { ascending: true, nullsFirst: true });

  const { data: venues, error } = await query;
  if (error) throw error;
  if (!venues?.length) {
    log("No active venues found. Did you run supabase/seed.sql?");
    return [];
  }

  const results: VenueResult[] = [];
  for (const v of venues as Venue[]) {
    if (opts.budgetMs && Date.now() - started > opts.budgetMs) {
      log(`Time budget reached; ${venues.length - results.length} venue(s) wait for the next run.`);
      break;
    }
    try {
      results.push(await ingestVenue(v, log, { dryRun: opts.dryRun }));
    } catch (err) {
      log(`! ${v.name} failed: ${(err as Error).message}`);
      results.push({ venue: v.name, events: 0, occurrences: 0, skipped: "error" });
    }
    // Marked as tried even when the page was thin or failed, so it doesn't hold the front of
    // the queue every day.
    if (!opts.dryRun && results.at(-1)?.skipped) {
      await supabase.from("venues").update({ last_ingested_at: new Date().toISOString() }).eq("id", v.id);
    }
  }
  return results;
}
