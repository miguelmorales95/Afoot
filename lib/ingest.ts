// Core ingest logic, shared by the CLI (scripts/ingest.ts), the scheduled cron
// route, and the newsletter pipeline (which reuses storeExtractedEvents).

import { supabase } from "./supabase";
import { fetchPageText, fetchRenderedText } from "./scrape";
import { extractEvents } from "./extract";
import type { ExtractedEvent, Venue } from "./types";
import { isRun } from "./format";
import { similarTitles, SAME_TIME_MS } from "./dedupe";

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

const HOUR = 3600 * 1000;

/**
 * The event this listing already is, under another title: same venue, a date within an hour,
 * and a similar title. Sources (and the extraction model, night to night) word the same show
 * differently, and the title is part of the event's key, so without this every rewording made
 * a new event. Returns the existing event's key and title, so the upsert lands on it.
 */
async function existingTwin(venueId: string, source: string, dedupeKey: string, title: string, starts: string[]) {
  if (!starts.length) return null;
  const { data: same } = await supabase.from("events").select("id").eq("dedupe_key", dedupeKey).maybeSingle();
  if (same) return null; // already known under this title
  const times = starts.map(Date.parse).filter((t) => !Number.isNaN(t));
  if (!times.length) return null;
  const { data, error } = await supabase
    .from("event_occurrences")
    .select("starts_at, event:events!inner(id, venue_id, title, status, dedupe_key, created_at, source)")
    .eq("event.venue_id", venueId)
    .eq("event.status", "active")
    // Same source only: the page is the authority for its own events' dates, so merging into
    // another source's event could drop dates only that source lists (duplicateDates covers those).
    .eq("event.source", source)
    .gte("starts_at", new Date(Math.min(...times) - SAME_TIME_MS).toISOString())
    .lte("starts_at", new Date(Math.max(...times) + SAME_TIME_MS).toISOString())
    .limit(2000);
  if (error || !data) return null; // never block an import on the dedup check
  const twins = (data as unknown as { starts_at: string; event: { title: string; dedupe_key: string; created_at: string } }[])
    .filter((o) => times.some((t) => Math.abs(Date.parse(o.starts_at) - t) <= SAME_TIME_MS) && similarTitles(title, o.event.title))
    .map((o) => o.event)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return twins[0] ? { dedupe_key: twins[0].dedupe_key, title: twins[0].title } : null;
}

/**
 * Phase 1 dedup: new dates of this event that another event at the same venue already lists
 * with a matching title within an hour (the same event reached us twice, e.g. newsletter and
 * calendar). Different events at the same time (a film and a tour) don't match on title and are
 * kept. Dates this event already has are never skipped, so re-imports can't delete them.
 */
async function duplicateDates(venueId: string, eventId: string, title: string, starts: string[]): Promise<Set<string>> {
  if (!starts.length) return new Set();
  const { data: own } = await supabase.from("event_occurrences").select("starts_at").eq("event_id", eventId);
  const ownTimes = new Set((own ?? []).map((o) => Date.parse(o.starts_at)));
  const fresh = starts.filter((s) => !ownTimes.has(Date.parse(s)));
  if (!fresh.length) return new Set();
  const times = fresh.map(Date.parse);
  const { data, error } = await supabase
    .from("event_occurrences")
    .select("starts_at, event:events!inner(id, venue_id, title, status)")
    .eq("event.venue_id", venueId)
    .neq("event_id", eventId)
    .eq("cancelled", false)
    .gte("starts_at", new Date(Math.min(...times) - HOUR).toISOString())
    .lte("starts_at", new Date(Math.max(...times) + HOUR).toISOString())
    .limit(2000);
  if (error || !data) return new Set(); // never block an import on the dedup check
  const others = (data as unknown as { starts_at: string; event: { title: string; status: string } }[])
    .filter((o) => o.event.status === "active" && similarTitles(title, o.event.title))
    .map((o) => Date.parse(o.starts_at));
  return new Set(fresh.filter((s) => others.some((t) => Math.abs(t - Date.parse(s)) <= HOUR)));
}

/**
 * Runs this event already lists that a new run overlaps. Pages that say "now through Dec 24"
 * give no start date, so the extractor uses the day it read the page: every re-read would
 * otherwise add the same run again with a new start. Returns the existing run each new one
 * falls inside (by new start time), so the new copy is skipped and the old one's end updated.
 */
async function overlappingRuns(eventId: string, rows: { starts_at: string; ends_at: string | null }[]) {
  const runs = rows.filter(isRun);
  const hits = new Map<string, { id: string; starts_at: string; ends_at: string }>();
  if (!runs.length) return hits;
  const { data } = await supabase.from("event_occurrences").select("id, starts_at, ends_at").eq("event_id", eventId).not("ends_at", "is", null);
  const existing = (data ?? []).filter(isRun);
  for (const r of runs) {
    const t = Date.parse(r.starts_at);
    const old = existing.find((e) => Date.parse(e.starts_at) !== t && Date.parse(e.starts_at) <= t && t < Date.parse(e.ends_at!));
    if (old) hits.set(r.starts_at, { id: old.id, starts_at: old.starts_at, ends_at: r.ends_at! });
  }
  return hits;
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
  source: "website" | "newsletter" | "manual" | "link" | "eventbrite" | "ticketmaster" | "feed";
  fallbackUrl?: string | null;
  log?: (s: string) => void;
}): Promise<number> {
  const log = opts.log ?? (() => {});
  let occurrenceCount = 0;

  for (const ev of opts.events) {
    let dedupeKey = `${opts.venueId}:${slugify(ev.title)}`;
    let title = ev.title;
    const twin = await existingTwin(opts.venueId, opts.source, dedupeKey, ev.title, ev.occurrences.map((o) => o.start));
    if (twin) {
      // Same event reworded: update the one we have and keep its title, so the card stays stable.
      log(`  ~ "${ev.title}" is "${twin.title}" reworded; updating that event`);
      dedupeKey = twin.dedupe_key;
      title = twin.title;
    }

    // Visitors confirmed a start time the page doesn't give: use it instead of the placeholder.
    let timeUnknown = !!ev.time_unknown;
    if (timeUnknown) {
      const { data: known } = await supabase.from("events").select("confirmed_time").eq("dedupe_key", dedupeKey).maybeSingle();
      if (known?.confirmed_time) {
        ev.occurrences = ev.occurrences.map((o) => ({ ...o, start: o.start.replace("T19:00:00", `T${known.confirmed_time}:00`) }));
        timeUnknown = false;
      }
    }

    const { data: eventRow, error: evErr } = await supabase
      .from("events")
      .upsert(
        {
          venue_id: opts.venueId,
          title,
          description: ev.description,
          category: ev.category,
          price: ev.price,
          url: ev.url || opts.fallbackUrl || null,
          recurrence_description: ev.recurrence_description,
          is_recurring: !!ev.is_recurring,
          tags: ev.tags ?? [],
          // Only when there is one, so a re-import without a tagline keeps the saved one.
          ...(ev.tagline ? { tagline: ev.tagline } : {}),
          ...(ev.schedule_label ? { schedule_label: ev.schedule_label } : {}),
          // A placeholder time is flagged, so cards say "Time TBA" and visitors are asked to confirm.
          ...(timeUnknown ? { uncertain_fields: ["starts_at"] } : {}),
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

    const dupes = await duplicateDates(opts.venueId, eventRow.id, ev.title, rows.map((r) => r.starts_at));
    const runs = await overlappingRuns(eventRow.id, rows);
    const filteredRows = rows.filter((r) => !dupes.has(r.starts_at) && !runs.has(r.starts_at));
    if (dupes.size) log(`  ~ "${ev.title}": ${dupes.size} date(s) already listed by a matching event here; skipped`);
    if (runs.size) {
      // Same run read again: keep the original (and its RSVPs/chat), take the page's current end date.
      for (const { id, ends_at } of runs.values()) await supabase.from("event_occurrences").update({ ends_at }).eq("id", id);
      log(`  ~ "${ev.title}": run already listed; kept the original start`);
    }

    // Dates the page no longer lists fall off, but never by deleting a date people said they're
    // going to or chatted about: those are marked cancelled instead (deleting would take their
    // RSVPs and messages with it). Dates still listed are updated in place, keeping their id.
    const dropped = await staleOccurrences(eventRow.id, [
      ...filteredRows.map((r) => Date.parse(r.starts_at)),
      ...[...runs.values()].map((r) => Date.parse(r.starts_at)),
    ]);
    if (dropped.keep.length) {
      await supabase.from("event_occurrences").update({ cancelled: true }).in("id", dropped.keep);
      log(`  ~ "${ev.title}": ${dropped.keep.length} dropped date(s) have RSVPs or chat; marked cancelled`);
    }
    if (dropped.remove.length) await supabase.from("event_occurrences").delete().in("id", dropped.remove);

    if (filteredRows.length) {
      const { error: occErr } = await supabase
        .from("event_occurrences")
        .upsert(filteredRows, { onConflict: "event_id,starts_at" });
      if (occErr) log(`  ! occurrences for "${ev.title}": ${occErr.message}`);
      else occurrenceCount += filteredRows.length;
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
