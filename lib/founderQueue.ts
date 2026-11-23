// The founder queue (/admin/queue) and the facts the founder emails are written from.
// Gaps are mostly per venue (one missing address hides hundreds of dates), so cards are
// per venue and one answer fixes every upcoming date there.
// Venue guide: a venue's usual price, parking and notes fill in only when an event's own post
// doesn't say (nearby_events falls back to them; the event's own price always wins).
import { supabase } from "./supabase";
import { geocode } from "./geocode";
import { LAUNCH_AREAS } from "./areas";

const DAY = 864e5;
export const OUTREACH_STATUSES = ["not_contacted", "contacted", "talking", "paying", "declined"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export const GUIDE_FIELDS = ["default_price", "parking", "good_to_know"] as const;
export type GuideField = (typeof GUIDE_FIELDS)[number];

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
  default_price: string | null;   // usual price
  parking: string | null;
  good_to_know: string | null;
  outreach_status: OutreachStatus;
  outreach_count: number;
  outreach_last_at: string | null;
  outreach_notes: string | null;
  skipped: boolean;
  dates: number;          // upcoming dates in the next 60 days
  soonDates: number;      // ... in the next 14 days
  noPriceDates: number;   // dates with no price from the post and no usual price
  nextAt: string | null;
  titles: string[];       // a few upcoming event titles
  knownPrices: string[];  // prices the venue's own posts give, as hints
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

async function inChunks<T>(ids: string[], fetch: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await fetch(ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/** Every venue with upcoming dates, with its gaps, guide and outreach record. */
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
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [venues, outreach] = await Promise.all([
    inChunks<Row>(ids, (c) => supabase.from("venues").select("id,name,website,events_url,address,city,lat,lng,default_price,parking,good_to_know").in("id", c)),
    inChunks<Row>(ids, (c) => supabase.from("venue_outreach").select("*").in("venue_id", c)),
  ]);
  const out = new Map(outreach.map((o) => [o.venue_id as string, o]));
  const now = Date.now();
  return venues.map((v) => {
    const a = agg.get(v.id)!, o = out.get(v.id);
    return {
      id: v.id, name: v.name, website: v.website, events_url: v.events_url, address: v.address, city: v.city,
      lat: v.lat, lng: v.lng, area: nearestArea(v.lat, v.lng),
      default_price: v.default_price, parking: v.parking, good_to_know: v.good_to_know,
      outreach_status: o?.status ?? "not_contacted", outreach_count: o?.contacts ?? 0,
      outreach_last_at: o?.last_at ?? null, outreach_notes: o?.notes ?? null,
      skipped: Boolean(o?.skip_until && Date.parse(o.skip_until) > now),
      dates: a.dates, soonDates: a.soonDates, noPriceDates: v.default_price?.trim() ? 0 : a.noPriceDates, nextAt: a.nextAt,
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

/** Sets one venue-guide field (usual price, parking, good to know); empty clears it. */
export async function updateGuide(venueId: string, field: string, value: string, dates = 0) {
  if (!GUIDE_FIELDS.includes(field as GuideField)) throw new Error("Unknown field");
  const clean = value.trim().slice(0, field === "default_price" ? 60 : 500) || null;
  const { error } = await supabase.from("venues").update({ [field]: clean }).eq("id", venueId);
  if (error) throw new Error(error.message);
  await logAction(field === "default_price" ? "price" : "guide", venueId, `${field}: ${clean ?? "(cleared)"}`, dates);
}

async function upsertOutreach(venueId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from("venue_outreach")
    .upsert({ venue_id: venueId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "venue_id" });
  if (error) throw new Error(error.message);
}

export async function skipVenue(venueId: string) {
  await upsertOutreach(venueId, { skip_until: new Date(Date.now() + 7 * DAY).toISOString() });
  await logAction("skip", venueId, "skipped for a week");
}

export async function updateOutreach(venueId: string, p: { status?: string; contacted?: boolean; notes?: string }) {
  const { data: cur } = await supabase.from("venue_outreach").select("status,contacts").eq("venue_id", venueId).maybeSingle();
  const patch: Record<string, unknown> = {};
  if (p.status) {
    if (!OUTREACH_STATUSES.includes(p.status as OutreachStatus)) throw new Error("Unknown status");
    patch.status = p.status;
  }
  if (p.notes !== undefined) patch.notes = p.notes.slice(0, 1000);
  if (p.contacted) {
    patch.contacts = (cur?.contacts ?? 0) + 1;
    patch.last_at = new Date().toISOString();
    if (!p.status && (cur?.status ?? "not_contacted") === "not_contacted") patch.status = "contacted";
  }
  await upsertOutreach(venueId, patch);
  await logAction("outreach", venueId, JSON.stringify(p).slice(0, 300));
}

/** What the founder fixed since a time, for "you did this" lines in the emails. */
export async function actionsSince(sinceIso: string) {
  const { data } = await supabase.from("founder_actions").select("kind,dates").gte("created_at", sinceIso);
  const out = { addresses: 0, prices: 0, guideNotes: 0, datesFixed: 0, outreach: 0 };
  for (const a of data ?? []) {
    if (a.kind === "address") out.addresses++;
    if (a.kind === "price") out.prices++;
    if (a.kind === "guide") out.guideNotes++;
    if (a.kind === "outreach") out.outreach++;
    out.datesFixed += a.dates ?? 0;
  }
  return out;
}
