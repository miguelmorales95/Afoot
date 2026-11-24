import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { demoNearby, isDemoMode } from "@/lib/demo";
import { hasLocalEvents, localNearby } from "@/lib/localEvents";
import { isRun } from "@/lib/format";
import { similarTitles, SAME_TIME_MS } from "@/lib/dedupe";

// GET /api/events?lat=..&lng=..&radius=15&days=30
// Returns upcoming event occurrences near a point, sorted by time.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lng = parseFloat(sp.get("lng") || "");
  const radius = Math.min(parseFloat(sp.get("radius") || "15") || 15, 80);
  const days = Math.min(parseInt(sp.get("days") || "30", 10) || 30, 60);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  if (hasLocalEvents()) {
    return NextResponse.json({ events: localNearby(lat, lng, radius, days) });
  }

  if (isDemoMode()) {
    return NextResponse.json({ events: demoNearby(lat, lng, radius), demo: true });
  }

  // The database returns at most 1,000 rows per request, so read in pages (busy areas have more).
  const PAGE = 1000, MAX_ROWS = 8000;
  const data: unknown[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data: page, error } = await supabase
      .rpc("nearby_events", { in_lat: lat, in_lng: lng, in_radius_km: radius, in_days_ahead: days })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("nearby_events error:", error.message);
      return NextResponse.json({ error: "query failed" }, { status: 500 });
    }
    data.push(...(page ?? []));
    if (!page || page.length < PAGE) break;
  }

  // Group by event + date, keep next occurrence + count per day
  const grouped = groupByEventAndDate(data as any[]);

  // `feedback`: events come from the database, so flags and checks can be saved.
  return NextResponse.json({ events: grouped, feedback: true });
}

/**
 * One card per run: a multi-day run ("through Dec 24") that starts inside an earlier run of
 * the same event is the same run read again on a later day, so only the earliest is kept.
 * A single date inside a run of the same event (or a similar title at the same venue) is that
 * run read as one day ("The Gingerbread Man Hunt", Time TBA, under its own "Until Dec 24" card),
 * so it goes too.
 */
function dropRepeatedRuns(occurrences: any[]) {
  const runs = occurrences
    .filter((o) => isRun(o))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const drop = new Set<string>();
  const kept = new Map<string, any[]>();
  for (const o of runs) {
    const prev = kept.get(o.event_id) ?? [];
    const t = Date.parse(o.starts_at);
    if (prev.some((p) => t < Date.parse(p.ends_at))) drop.add(o.occurrence_id);
    else kept.set(o.event_id, [...prev, o]);
  }
  const allRuns = [...kept.values()].flat();
  for (const o of occurrences) {
    if (isRun(o) || !allRuns.length) continue;
    const t = Date.parse(o.starts_at);
    const inside = allRuns.some((r) =>
      (r.event_id === o.event_id || (r.venue_id === o.venue_id && similarTitles(r.title, o.title))) &&
      Date.parse(r.starts_at) <= t && t < Date.parse(r.ends_at));
    if (inside) drop.add(o.occurrence_id);
  }
  return drop.size ? occurrences.filter((o) => !drop.has(o.occurrence_id)) : occurrences;
}

/**
 * One card per show: different events at the same venue starting within an hour with similar
 * titles ("David Benoit: A Charlie Brown Christmas" and "... (with Courtney Fortune)") are the
 * same show listed twice; the better-ranked listing is kept. A safety net for duplicates already
 * stored; imports now merge them (lib/ingest.ts) and scripts/merge-dupes.ts cleans old ones.
 */
function dropTwinEvents(occurrences: any[]) {
  const byVenue = new Map<string, any[]>();
  for (const o of occurrences) (byVenue.get(o.venue_id) ?? byVenue.set(o.venue_id, []).get(o.venue_id)!).push(o);
  const drop = new Set<string>();
  for (const list of byVenue.values()) {
    if (list.length < 2) continue;
    const ranked = [...list].sort((a, b) => (b.traffic_score ?? 0) - (a.traffic_score ?? 0));
    const kept: any[] = [];
    for (const o of ranked) {
      const t = Date.parse(o.starts_at);
      const twin = kept.find(
        (k) => k.event_id !== o.event_id && Math.abs(Date.parse(k.starts_at) - t) <= SAME_TIME_MS && similarTitles(k.title, o.title),
      );
      if (twin) drop.add(o.occurrence_id);
      else kept.push(o);
    }
  }
  return drop.size ? occurrences.filter((o) => !drop.has(o.occurrence_id)) : occurrences;
}

/**
 * Group occurrences by event + date (LA timezone).
 * For each group, keep the next occurrence and add occurrence_count_today.
 */
function groupByEventAndDate(all: any[]) {
  const tz = "America/Los_Angeles";
  const groups = new Map<string, any[]>();
  const occurrences = dropTwinEvents(dropRepeatedRuns(all));

  for (const occ of occurrences) {
    // Format: YYYY-MM-DD in LA timezone
    const date = new Date(occ.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
    const key = `${occ.event_id}:${date}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(occ);
  }

  // Track last occurrence date for each event (for recurring events)
  const eventLastDate = new Map<string, Date>();
  for (const occ of occurrences) {
    const occDate = new Date(occ.starts_at);
    const lastKnown = eventLastDate.get(occ.event_id);
    if (!lastKnown || occDate > lastKnown) {
      eventLastDate.set(occ.event_id, occDate);
    }
  }

  // For each group, keep the first (soonest) and add count
  const result = [];
  for (const [, occs] of groups) {
    // Sort by start time, keep earliest
    occs.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const nextOcc = occs[0];

    // Add count of additional times that day + last date if recurring
    const lastDate = eventLastDate.get(nextOcc.event_id);
    result.push({
      ...nextOcc,
      occurrence_count_today: occs.length,
      occurrence_count_remaining: Math.max(0, occs.length - 1),
      last_occurrence_date: nextOcc.is_recurring && lastDate ? lastDate.toISOString() : null,
    });
  }

  // Re-sort by original order (date, traffic, going_count, start time, distance)
  return result.sort((a, b) => {
    const dateA = new Date(a.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
    const dateB = new Date(b.starts_at).toLocaleDateString("en-CA", { timeZone: tz });
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const trafficDiff = (b.traffic_score ?? 0) - (a.traffic_score ?? 0);
    if (trafficDiff !== 0) return trafficDiff;

    const goingDiff = (b.going_count ?? 0) - (a.going_count ?? 0);
    if (goingDiff !== 0) return goingDiff;

    const timeDiff = new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    if (timeDiff !== 0) return timeDiff;

    return (a.distance_km ?? 0) - (b.distance_km ?? 0);
  });
}
