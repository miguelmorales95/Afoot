// Nightly traffic scores (lib/rank.ts), no AI. Runs after the ingest in .github/workflows/ingest.yml.
//   1. Venues whose draw is over a week old get a new one from Wikipedia page views (venues set
//      by hand, draw_source = 'manual', are never touched).
//   2. Every upcoming event gets traffic_score from the formula; nearby_events orders each day by it.
//   npm run rank            npm run rank -- --dry (print the top and bottom, save nothing)
import "./env";
import { supabase } from "../lib/supabase";
import { drawFromViews, trafficScore } from "../lib/rank";

const DAY = 864e5;
const UA = "AfootRank/1.0 (https://afoot.somedude.app; weekly venue popularity)";
const STOP = new Set(["the", "and", "of", "at", "a", "an", "in"]);
// Place words say where a venue is, not which one it is, so they don't count toward a match.
const PLACE = new Set(["los", "angeles", "la", "california", "ca", "long", "beach", "santa", "monica", "pasadena", "glendale", "hollywood", "west", "east", "north", "south", "city", "county", "downtown", "dtla", "burbank", "pomona", "riverside"]);
const LA_WORDS = /los angeles|california|long beach|pasadena|santa monica|glendale|burbank|hollywood|malibu|pomona|orange county|inglewood|torrance|culver city/i;

const tokens = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Api-User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  return res.ok ? res.json() : null;
}

/** The venue's English Wikipedia article (if a search finds one that clearly is it) and its average monthly views. */
async function wikiViews(name: string, city: string | null): Promise<{ title: string; views: number } | null> {
  const q = new URLSearchParams({ action: "query", list: "search", srsearch: `${name} ${city || "Los Angeles"}`, srlimit: "3", format: "json" });
  const found = await getJson(`https://en.wikipedia.org/w/api.php?${q}`);
  const all = tokens(name), mine = all.filter((t) => !PLACE.has(t)), places = all.filter((t) => PLACE.has(t));
  if (!mine.length) return null;
  for (const hit of (found?.query?.search ?? []) as { title: string; snippet: string }[]) {
    const theirAll = tokens(hit.title), theirs = theirAll.filter((t) => !PLACE.has(t));
    if (places.length && !places.some((t) => theirAll.includes(t))) continue;
    const covered = mine.filter((t) => theirs.includes(t)).length / mine.length;
    const back = theirs.filter((t) => mine.includes(t)).length / Math.max(1, theirs.length);
    const local = LA_WORDS.test(`${hit.title} ${hit.snippet}`) || (city ? hit.snippet.toLowerCase().includes(city.toLowerCase()) : false);
    // The article is clearly this venue when nearly all its title words are in the venue name
    // ("The Groundlings" for "The Groundlings Theatre"). Articles about a city or neighborhood
    // ("Compton, California") never count.
    if (/, (California|Los Angeles|Los Angeles County)$/.test(hit.title)) continue;
    if (back < 0.75 || covered < 0.4 || !local) continue;
    const end = new Date(); end.setUTCDate(1);
    const start = new Date(end); start.setUTCMonth(start.getUTCMonth() - 3);
    const ym = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}01`;
    const pv = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(hit.title.replace(/ /g, "_"))}/monthly/${ym(start)}/${ym(end)}`);
    const items = (pv?.items ?? []) as { views: number }[];
    if (!items.length) return { title: hit.title, views: 0 };
    return { title: hit.title, views: Math.round(items.reduce((n, i) => n + i.views, 0) / items.length) };
  }
  return null;
}

function laWeekendEvening(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return p.weekday === "Sat" || p.weekday === "Sun" || (p.weekday === "Fri" && Number(p.hour) >= 17);
}

async function main() {
  const dry = process.argv.includes("--dry");

  // Upcoming dates per event.
  const dates = new Map<string, { n: number; weekend: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("event_occurrences").select("event_id, starts_at")
      .gte("starts_at", new Date().toISOString()).lte("starts_at", new Date(Date.now() + 60 * DAY).toISOString())
      .eq("cancelled", false).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const o of data) {
      const d = dates.get(o.event_id) ?? { n: 0, weekend: 0 };
      d.n++; if (laWeekendEvening(o.starts_at)) d.weekend++;
      dates.set(o.event_id, d);
    }
    if (data.length < 1000) break;
  }

  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ids = [...dates.keys()];
  const events: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("events").select("id,title,category,price,is_recurring,venue_id").in("id", ids.slice(i, i + 200)).eq("status", "active");
    if (error) throw new Error(error.message);
    events.push(...data);
  }

  // 1. Venue draws, refreshed at most weekly.
  const venueIds = [...new Set(events.map((e) => e.venue_id as string))];
  const venues = new Map<string, Row>();
  for (let i = 0; i < venueIds.length; i += 200) {
    const { data, error } = await supabase.from("venues").select("id,name,city,draw,draw_source,draw_updated_at,default_price").in("id", venueIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    data.forEach((v) => venues.set(v.id, v));
  }
  const weekAgo = Date.now() - 7 * DAY;
  let refreshed = 0, onWiki = 0;
  for (const v of venues.values()) {
    if (v.draw_source === "manual" || (v.draw_updated_at && Date.parse(v.draw_updated_at) > weekAgo)) continue;
    const w = await wikiViews(v.name, v.city).catch(() => null);
    await sleep(150);
    v.draw = drawFromViews(w ? w.views : null, v.name);
    refreshed++; if (w) onWiki++;
    if (dry) { console.log(`venue ${String(v.draw).padStart(3)}  ${v.name}${w ? `  ← ${w.title} (${w.views}/mo)` : ""}`); continue; }
    await supabase.from("venues").update({ draw: v.draw, draw_source: w ? "wikipedia" : "default", wiki_title: w?.title ?? null, wiki_views: w?.views ?? null, draw_updated_at: new Date().toISOString() }).eq("id", v.id);
  }
  console.log(`Venue draws refreshed: ${refreshed} (${onWiki} found on Wikipedia).`);

  // 2. Taps in the last two weeks.
  const since = (days: number) => new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const taps = new Map<string, { c7: number; cPrev: number }>();
  const { data: daily } = await supabase.from("event_daily").select("event_id,day,clicks").gte("day", since(14)).gt("clicks", 0).limit(20000);
  for (const d of daily ?? []) {
    const t = taps.get(d.event_id) ?? { c7: 0, cPrev: 0 };
    if (d.day >= since(7)) t.c7 += d.clicks; else t.cPrev += d.clicks;
    taps.set(d.event_id, t);
  }

  // 3. Scores.
  const scored = events.map((e) => {
    const v = venues.get(e.venue_id), d = dates.get(e.id)!, t = taps.get(e.id);
    const price = (e.price || v?.default_price || "").trim();
    return {
      id: e.id as string, title: e.title as string, venue: v?.name as string,
      score: trafficScore({
        venueDraw: v?.draw ?? 30, title: e.title, category: e.category, recurring: Boolean(e.is_recurring),
        dates: d.n, weekendDates: d.weekend, free: /^free\b/i.test(price),
        clicks7: t?.c7 ?? 0, clicksPrev7: t?.cPrev ?? 0,
      }),
    };
  }).sort((a, b) => b.score - a.score);

  if (dry) {
    const show = (s: typeof scored) => s.forEach((x) => console.log(`${String(x.score).padStart(3)}  ${x.title}  · ${x.venue}`));
    console.log("\nTop 15:"); show(scored.slice(0, 15));
    console.log("\nBottom 10:"); show(scored.slice(-10));
    return;
  }
  let changed = 0;
  for (let i = 0; i < scored.length; i += 500) {
    const { data, error } = await supabase.rpc("set_traffic_scores", { p: scored.slice(i, i + 500).map(({ id, score }) => ({ id, score })) });
    if (error) throw new Error(error.message);
    changed += data as number;
  }
  console.log(`Scored ${scored.length} upcoming event(s); ${changed} changed.`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
