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

/**
 * Upsert a batch of extracted events (and their occurrences) for one venue.
 * Idempotent: events keyed by dedupe_key, future occurrences replaced.
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

    // Replace this event's future occurrences so cancellations fall off.
    await supabase
      .from("event_occurrences")
      .delete()
      .eq("event_id", eventRow.id)
      .gte("starts_at", new Date().toISOString());

    const rows = ev.occurrences
      .map((o) => ({ event_id: eventRow.id, starts_at: o.start, ends_at: o.end }))
      .filter((r) => {
        const t = Date.parse(r.starts_at);
        return !Number.isNaN(t) && t >= Date.now() - 12 * 3600 * 1000;
      });

    if (rows.length) {
      const { error: occErr } = await supabase
        .from("event_occurrences")
        .upsert(rows, { onConflict: "event_id,starts_at", ignoreDuplicates: true });
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

export async function ingestVenue(venue: Venue, log = console.log): Promise<VenueResult> {
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
  opts: { onlySlug?: string; log?: (s: string) => void } = {},
): Promise<VenueResult[]> {
  const log = opts.log ?? console.log;

  let query = supabase.from("venues").select("*").eq("active", true);
  if (opts.onlySlug) query = query.eq("slug", opts.onlySlug);

  const { data: venues, error } = await query;
  if (error) throw error;
  if (!venues?.length) {
    log("No active venues found. Did you run supabase/seed.sql?");
    return [];
  }

  const results: VenueResult[] = [];
  for (const v of venues as Venue[]) {
    try {
      results.push(await ingestVenue(v, log));
    } catch (err) {
      log(`! ${v.name} failed: ${(err as Error).message}`);
      results.push({ venue: v.name, events: 0, occurrences: 0, skipped: "error" });
    }
  }
  return results;
}
