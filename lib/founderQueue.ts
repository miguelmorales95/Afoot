// The founder queue (/admin/queue) and the facts the founder emails are written from.
// Gaps are mostly per venue (one missing address hides hundreds of dates), so cards are
// per venue and one answer fixes every upcoming date there.
import { supabase } from "./supabase";
import { geocode } from "./geocode";
import { LAUNCH_AREAS } from "./areas";

const DAY = 864e5;
export const OUTREACH_STATUSES = ["not_contacted", "contacted", "talking", "paying", "declined"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export interface VenueStat {
  id: string;
  name: string;
  website: string | null;
  events_url: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  area: string | null;
  default_price: string | null;
  outreach_status: OutreachStatus;
  outreach_count: number;
  outreach_last_at: string | null;
  outreach_notes: string | null;
  skipped: boolean;
  dates: number;          // upcoming dates in the next 60 days
  soonDates: number;      // ... in the next 14 days
  noPriceDates: number;
  nextAt: string | null;
  titles: string[];       // a few upcoming event titles
  knownPrices: string[];  // prices already on this venue's events, as hints
}

export interface QueueCard {
  kind: "address" | "price";
  venue: VenueStat;
  fixes: number;          // upcoming dates this one answer completes
  planned: boolean;       // picked by this week's AI plan
}

/** The launch area within ~6 km of a point, for grouping venues into one trip. */
export function nearestArea(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  let best: { name: string; d: number } | null = null;
  for (const a of LAUNCH_AREAS) {
    const d = Math.hypot((a.lat - lat) * 111, (a.lng - lng) * 92);
    if (!best || d < best.d) best = { name: a.name, d };
  }
  return best && best.d <= 6 ? best.name : null;
}

async function upcomingOccurrences() {
  const now = new Date().toISOString(), until = new Date(Date.now() + 60 * DAY).toISOString();
  const rows: { starts_at: string; event: { id: string; title: string; price: string | null; status: string; venue_id: string } | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("event_occurrences")
      .select("starts_at, event:events(id,title,price,status,venue_id)")
      .gte("starts_at", now).lte("starts_at", until).eq("cancelled", false)
      .order("starts_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as unknown as typeof rows));
    if (data.length < 1000) break;
  }
  return rows.filter((r) => r.event?.status === "active");
}

/** Every venue with upcoming dates, with its gaps and outreach record. */
export async function venueStats(): Promise<VenueStat[]> {
  const occ = await upcomingOccurrences();
  const soon = Date.now() + 14 * DAY;
  const agg = new Map<string, { dates: number; soonDates: number; noPriceDates: number; nextAt: string; titles: Set<string>; prices: Set<string> }>();
  for (const o of occ) {
    const e = o.event!;
    let a = agg.get(e.venue_id);
    if (!a) agg.set(e.venue_id, (a = { dates: 0, soonDates: 0, noPriceDates: 0, nextAt: o.starts_at, titles: new Set(), prices: new Set() }));
    a.dates++;
    if (Date.parse(o.starts_at) < soon) a.soonDates++;
    if (!e.price?.trim()) a.noPriceDates++;
    else if (a.prices.size < 4) a.prices.add(e.price.trim());
    if (a.titles.size < 4) a.titles.add(e.title);
  }
  const ids = [...agg.keys()];
  const venues: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("venues")
      .select("id,name,website,events_url,address,city,lat,lng,active,default_price,outreach_status,outreach_count,outreach_last_at,outreach_notes,queue_skip_until")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    venues.push(...data);
  }
  const now = Date.now();
  return venues.map((v) => {
    const a = agg.get(v.id as string)!;
    return {
      id: v.id, name: v.name, website: v.website, events_url: v.events_url, address: v.address, city: v.city,
      lat: v.lat, lng: v.lng, area: nearestArea(v.lat as number | null, v.lng as number | null),
      default_price: v.default_price, outreach_status: v.outreach_status, outreach_count: v.outreach_count,
      outreach_last_at: v.outreach_last_at, outreach_notes: v.outreach_notes,
      skipped: Boolean(v.queue_skip_until && Date.parse(v.queue_skip_until as string) > now),
      dates: a.dates, soonDates: a.soonDates, noPriceDates: a.noPriceDates, nextAt: a.nextAt,
      titles: [...a.titles], knownPrices: [...a.prices],
    } as VenueStat;
  });
}

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from("founder_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string) ?? null;
}

export async function setSetting(key: string, value: string) {
  const { error } = await supabase.from("founder_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** Venue ids the latest Monday plan put first. */
async function plannedVenueIds(): Promise<string[]> {
  try { return JSON.parse((await getSetting("weekly_plan")) || "{}").venueIds ?? []; } catch { return []; }
}

/** Address before price (the founder's order); within a kind, the most dates fixed, soonest weighted double. */
export function rankCards(stats: VenueStat[], planned: string[] = []): QueueCard[] {
  const cards: QueueCard[] = [];
  for (const v of stats) {
    if (v.skipped) continue;
    if (!v.address || v.lat == null) cards.push({ kind: "address", venue: v, fixes: v.dates, planned: planned.includes(v.id) });
    if (v.noPriceDates > 0) cards.push({ kind: "price", venue: v, fixes: v.noPriceDates, planned: planned.includes(v.id) });
  }
  const score = (c: QueueCard) =>
    (c.planned ? 1e6 : 0) + (c.fixes + (c.kind === "address" ? c.venue.soonDates : 0)) * (c.kind === "address" ? 3 : 1);
  return cards.sort((a, b) => score(b) - score(a));
}

export async function queue() {
  const [stats, planned] = await Promise.all([venueStats(), plannedVenueIds()]);
  const cards = rankCards(stats, planned);
  const count = async (table: string, col: string, val: string) =>
    (await supabase.from(table).select("id", { count: "exact", head: true }).eq(col, val)).count ?? 0;
  const [links, flags, submissions] = await Promise.all([
    count("event_links", "status", "pending"), count("event_flags", "status", "open"), count("submissions", "status", "pending"),
  ]);
  const totals = {
    dates: stats.reduce((n, v) => n + v.dates, 0),
    noAddressDates: stats.filter((v) => !v.address || v.lat == null).reduce((n, v) => n + v.dates, 0),
    noPriceDates: stats.reduce((n, v) => n + v.noPriceDates, 0),
  };
  return { cards: cards.slice(0, 40), remaining: cards.length, totals, waiting: { links, flags, submissions } };
}

async function logAction(kind: string, venueId: string, detail: string, dates = 0) {
  await supabase.from("founder_actions").insert({ kind, venue_id: venueId, detail, dates });
}

export async function suggestAddress(venueId: string): Promise<string | null> {
  const { data: v } = await supabase.from("venues").select("name,city").eq("id", venueId).single();
  if (!v) return null;
  const g = await geocode(`${v.name}, ${v.city || "Los Angeles"}, CA`);
  return g ? g.label.replace(/, United States$/, "") : null;
}

export async function fillAddress(venueId: string, address: string, dates = 0) {
  const clean = address.trim().slice(0, 300);
  if (!clean) throw new Error("Address is empty");
  const g = await geocode(clean);
  const patch: Record<string, unknown> = { address: clean };
  if (g) { patch.lat = g.lat; patch.lng = g.lng; }
  const { error } = await supabase.from("venues").update(patch).eq("id", venueId);
  if (error) throw new Error(error.message);
  await logAction("address", venueId, clean, dates);
  return { geocoded: Boolean(g) };
}

/** Sets the venue's default and fills every event there that has no price. */
export async function fillPrice(venueId: string, price: string, dates = 0) {
  const clean = price.trim().slice(0, 60);
  if (!clean) throw new Error("Price is empty");
  const { error } = await supabase.from("venues").update({ default_price: clean }).eq("id", venueId);
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("events").update({ price: clean, updated_at: new Date().toISOString() })
    .eq("venue_id", venueId).or("price.is.null,price.eq.");
  if (e2) throw new Error(e2.message);
  await logAction("price", venueId, clean, dates);
}

export async function skipVenue(venueId: string) {
  await supabase.from("venues").update({ queue_skip_until: new Date(Date.now() + 7 * DAY).toISOString() }).eq("id", venueId);
  await logAction("skip", venueId, "skipped for a week");
}

export async function updateOutreach(venueId: string, p: { status?: string; contacted?: boolean; notes?: string }) {
  const patch: Record<string, unknown> = {};
  if (p.status) {
    if (!OUTREACH_STATUSES.includes(p.status as OutreachStatus)) throw new Error("Unknown status");
    patch.outreach_status = p.status;
  }
  if (p.notes !== undefined) patch.outreach_notes = p.notes.slice(0, 1000);
  if (p.contacted) {
    const { data } = await supabase.from("venues").select("outreach_count,outreach_status").eq("id", venueId).single();
    patch.outreach_count = (data?.outreach_count ?? 0) + 1;
    patch.outreach_last_at = new Date().toISOString();
    if (!p.status && data?.outreach_status === "not_contacted") patch.outreach_status = "contacted";
  }
  const { error } = await supabase.from("venues").update(patch).eq("id", venueId);
  if (error) throw new Error(error.message);
  await logAction("outreach", venueId, JSON.stringify(p).slice(0, 300));
}

/** What the founder fixed since a time, for "you did this" lines in the emails. */
export async function actionsSince(sinceIso: string) {
  const { data } = await supabase.from("founder_actions").select("kind,dates").gte("created_at", sinceIso);
  const out = { addresses: 0, prices: 0, datesFixed: 0, outreach: 0 };
  for (const a of data ?? []) {
    if (a.kind === "address") out.addresses++;
    if (a.kind === "price") out.prices++;
    if (a.kind === "outreach") out.outreach++;
    out.datesFixed += a.dates ?? 0;
  }
  return out;
}
