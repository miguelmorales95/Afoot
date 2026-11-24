// Ranking lab: what three "small events first" boosts would do to each day's order, side by side
// with today's traffic_score. Read-only: pulls the next ~3 weeks from Supabase and writes one
// data file for the lab page (rank-lab.html next to it), which does the math in the browser so
// the strength can be dragged.
//
//   npm run rank:lab -- <out-dir>        (default: ./rank-lab)
//
// Each venue gets a "scene":
//   institution  calendar feeds (colleges, councils, parks, libraries), or a name / .edu / .gov
//                that says so
//   big          not an institution, and well known (venue draw >= 60, from Wikipedia views), or a
//                mall / arena / landmark by name (most venues have no Wikipedia draw: default 30)
//   indie        everything else: bars, clubs, comedy rooms, cafes, record stores, galleries
// and each event a "channel": curator (an IG curator sent it; none yet), community (a link or
// newsletter someone sent), venue_site, ticketing (Dice, Eventbrite, Ticketmaster...), feed.
//
// The three methods, each = traffic_score + a boost scaled by strength N:
//   A  Flat indie boost     +N for every indie-venue event. Boost them all equally.
//   B  Fame stops counting  take back the fame term (0.55 x (draw - 30)), then indie venues get
//                           up to +N, more the less known they are: N x clamp((60 - draw) / 40).
//   C  Where it came from   curator +N, community +0.8N, indie venue site +0.5N, ticketing and
//                           big venues 0, institutional feeds -0.4N. "Boost what curators send."
import "./env";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabase } from "../lib/supabase";
import { INDIE_BOOST, venueScene } from "../lib/rank";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 864e5;
// When the indie boost went into the nightly rank (scores saved after this include it).
const BOOST_LIVE = Date.parse("2026-11-25T00:00:00Z");
const TICKETING = /(^|\.)(dice\.fm|eventbrite\.[a-z.]+|ticketmaster\.com|livenation\.com|axs\.com|seetickets\.us|tixr\.com|etix\.com)$/i;

const host = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
const laDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const laMinutes = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
};

async function all(table: string, cols: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(table).select(cols).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data as unknown as Row[]));
  }
  return out;
}

async function main() {
  const outDir = process.argv[2] || "rank-lab";
  const occ: Row[] = [];
  const from = new Date(), to = new Date(Date.now() + 21 * DAY);
  for (let n = 0; ; n += 1000) {
    const { data, error } = await supabase.from("event_occurrences").select("event_id,starts_at")
      .gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()).eq("cancelled", false).range(n, n + 999);
    if (error) throw new Error(error.message);
    occ.push(...data);
    if (data.length < 1000) break;
  }
  const evs = (await all("events", "id,title,category,url,source,venue_id,traffic_score,traffic_scored_at,status", [...new Set(occ.map((o) => o.event_id as string))])).filter((e) => e.status === "active");
  const vs = await all("venues", "id,name,draw,source", [...new Set(evs.map((e) => e.venue_id as string))]);
  writeLab(outDir, occ, evs, vs);
}

export function writeLab(outDir: string, occ: Row[], evs: Row[], vs: Row[]) {
  const venues = new Map(vs.map((v) => [v.id, v]));
  const venueIdx = new Map<string, number>();
  const venueRows: [string, string, number][] = []; // name, scene, draw
  for (const v of vs) {
    const anyUrl = evs.find((e) => e.venue_id === v.id)?.url ?? null;
    const h = host(anyUrl);
    const scene = venueScene(v as { name: string; source: string | null; draw: number | null }, anyUrl);
    venueIdx.set(v.id, venueRows.length);
    venueRows.push([v.name, scene, v.draw ?? 30]);
  }
  const evIdx = new Map<string, number>();
  const eventRows: [string, number, string, string, number][] = []; // title, venue, category, channel, score
  for (const e of evs) {
    if (!venues.has(e.venue_id)) continue;
    const src = e.source as string;
    const channel = src === "curator" ? "curator" : src === "link" || src === "newsletter" ? "community" : TICKETING.test(host(e.url)) ? "ticketing" : src === "feed" ? "feed" : "venue_site";
    evIdx.set(e.id, eventRows.length);
    // Stored scores include the indie boost once the nightly rank has run with it (lib/rank.ts);
    // take it back out so the lab's "Current" is the unboosted order and A/B/C add on top.
    const boosted = e.traffic_scored_at && Date.parse(e.traffic_scored_at) >= BOOST_LIVE && venueRows[venueIdx.get(e.venue_id)!][1] === "indie";
    eventRows.push([e.title, venueIdx.get(e.venue_id)!, e.category ?? "other", channel, (e.traffic_score ?? 30) - (boosted ? INDIE_BOOST : 0)]);
  }
  const days: Record<string, [number, number][]> = {};
  for (const o of occ) {
    const i = evIdx.get(o.event_id);
    if (i === undefined) continue;
    (days[laDay(o.starts_at)] ??= []).push([i, laMinutes(o.starts_at)]);
  }
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(__dirname, "rank-lab.html"), join(outDir, "rank-lab.html"));
  writeFileSync(join(outDir, "rank-lab-data.json"), JSON.stringify({ generated: new Date().toISOString(), venues: venueRows, events: eventRows, days }));
  console.log(`Wrote ${outDir}/rank-lab.html + rank-lab-data.json: ${eventRows.length} events, ${Object.keys(days).length} days.`);
}

if (require.main === module) main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
