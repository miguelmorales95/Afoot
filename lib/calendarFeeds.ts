// Official calendar feeds: the public calendars of colleges, libraries, parks departments,
// museums and malls, read from the machine-readable feed they publish instead of scraping pages
// with the AI. Two kinds (event_feeds.kind):
//   ics       an iCalendar URL (Trumba, LiveWhale, LibCal, CivicPlus, Google Calendar,
//             WordPress "The Events Calendar" ?ical=1, Squarespace ?format=ical, Localist .ics…)
//   localist  a Localist calendar's API (https://calendar.example.edu/api/2/events): richer than
//             its iCal (place names, map pins, ticket links, in person or online)
// Events that carry a map pin go to that place's venue; the rest go to the feed's own venue
// (the campus, the library…). Feed options (event_feeds.options, all optional):
//   { "include": "regex", "exclude": "regex", "days": 60, "public_only": true, "max": 400 }
import ical, { type VEvent } from "node-ical";
import type { EventCategory } from "./types";
import type { LinkedEvent } from "./eventApis";

export interface FeedOptions { include?: string; exclude?: string; days?: number; public_only?: boolean; max?: number }

/** A feed event, before it's given a venue. */
export interface FeedEvent extends LinkedEvent {
  all_day: boolean;
}

const UA = "AfootBot/1.0 (+https://afoot.somedude.app; local events listing)";
const TZ = "America/Los_Angeles";

// Academic and administrative entries that aren't events anyone would go to.
const NOISE = new RegExp([
  "deadline", "last day", "first day of", "registration (opens|closes|begins|ends)", "holiday", "campus (is )?closed",
  "no classes", "finals? week", "final exams?", "add/drop", "withdraw", "census", "grades due", "office hours",
  "staff meeting", "faculty (senate|meeting)", "board of trustees", "committee", "advising", "orientation",
  "webinar", "zoom", "virtual", "online only", "canceled", "cancelled", "postponed", "spring break", "winter break",
  "payment due", "financial aid", "info session", "information session", "drop-in tutoring",
  // Closures and government business.
  "\\bclosed\\b", "closure", "commission", "board meeting", "council meeting", "public hearing", "study session",
  "planning (meeting|session)", "agenda",
  // More academic calendar entries, and observance lists ("All Saints' Day (Christian)").
  "registration", "waitlist", "permitted", "admission", "dissertation", "defense", "senate", "vote center",
  "daylight saving", "test event", "rehearsals?", "flu (shots?|vaccines?|clinics?)", "blood drive", "chapel service",
  "\\((christian|jewish|muslim|islamic|hindu|buddhist|sikh|bah[aá]'?[ií]|orthodox|catholic)\\)",
].join("|"), "i");

const CATEGORY: [EventCategory, RegExp][] = [
  ["karaoke", /\bkaraoke\b/i],
  ["trivia", /\btrivia\b|\bquiz night\b/i],
  ["comedy", /\bcomedy\b|\bstand-?up\b|\bimprov\b/i],
  ["games", /\bboard games?\b|\bgame night\b|\bchess\b|\bbingo\b|\bgaming\b|\btabletop\b|\bdungeons\b/i],
  ["market", /\b(farmers'? )?market\b|\bbazaar\b|\bcraft fair\b|\bswap meet\b|\bflea\b|\bpop-?up shop\b/i],
  ["food", /\bfood\b|\btasting\b|\bcooking\b|\bdinner\b|\bbrunch\b|\bwine\b|\bbeer\b|\btacos?\b/i],
  ["music", /\bconcerts?\b|\bmusic(al)?\b|\bband\b|\bjazz\b|\borchestra\b|\bsymphony\b|\bchoirs?\b|\bchoral\b|\brecitals?\b|\bdj\b|\bopera\b|\bensembles?\b|\bsing(ing|ers?|-?along)?\b/i],
  ["class", /\bclass(es)?\b|\bworkshops?\b|\blectures?\b|\btalks?\b|\breadings?\b|\bbook club\b|\bseminars?\b|\bpanel\b|\bdiscussion\b|\btours?\b|\bstory ?time\b|\bcrafts?\b|\blessons?\b|\bfilms?\b|\bscreenings?\b|\bexhibit(ion)?s?\b/i],
];

export function categoryFor(text: string): EventCategory {
  return CATEGORY.find(([, re]) => re.test(text))?.[0] ?? "other";
}

/** The offset of Los Angeles from UTC at a moment, e.g. "-07:00". */
function laOffset(at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "longOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  return name.replace("GMT", "") || "+00:00";
}

/** Midnight in Los Angeles on a calendar date (for all-day entries). */
function laMidnight(y: number, m: number, d: number): string {
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00${laOffset(guess)}`;
}

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in (v as object)) return String((v as { val: unknown }).val ?? "");
  return String(v);
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
/** Feed text without tags, HTML entities ("&#39;", "&amp;") or extra spaces. */
const clean = (s: string, max: number) => s
  .replace(/<[^>]+>/g, " ")
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
  .replace(/\s+/g, " ").trim().slice(0, max);

function keep(e: FeedEvent, opts: FeedOptions, now: number): boolean {
  const hay = `${e.title} ${e.description ?? ""}`;
  if (!e.title || Date.parse(e.starts_at) < now - 6 * 3600_000) return false;
  if (opts.include && !new RegExp(opts.include, "i").test(hay)) return false;
  if (opts.exclude && new RegExp(opts.exclude, "i").test(hay)) return false;
  return !NOISE.test(e.title);
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/calendar, application/json, */*" }, signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res;
}

/** Upcoming events in an iCalendar feed, with repeating ones expanded into dates. */
export async function icsEvents(url: string, opts: FeedOptions = {}): Promise<FeedEvent[]> {
  const body = await (await get(url.replace(/^webcal:/i, "https:"))).text();
  if (!body.includes("BEGIN:VCALENDAR")) throw new Error("not an iCalendar feed");
  const now = Date.now();
  const from = new Date(now - 6 * 3600_000), to = new Date(now + (opts.days ?? 60) * 86_400_000);
  const out: FeedEvent[] = [];
  for (const c of Object.values(ical.sync.parseICS(body))) {
    if (!c || c.type !== "VEVENT") continue;
    const ev = c as VEvent;
    if (ev.status === "CANCELLED") continue;
    const instances = ev.rrule
      ? ical.expandRecurringEvent(ev, { from, to }).map((i) => ({ start: i.start as Date, end: i.end as Date | undefined, allDay: i.isFullDay }))
      : [{ start: ev.start as Date, end: ev.end as Date | undefined, allDay: ev.datetype === "date" }];
    const geo = ev.geo as { lat?: number; lon?: number } | undefined;
    const location = clean(text(ev.location), 200) || null;
    for (const i of instances) {
      if (!i.start || i.start > to) continue;
      // An all-day entry that runs for days is usually an exhibit or a term date, not an outing.
      if (i.allDay && i.end && i.end.getTime() - i.start.getTime() > 86_400_000 + 3600_000) continue;
      const starts_at = i.allDay ? laMidnight(i.start.getUTCFullYear(), i.start.getUTCMonth() + 1, i.start.getUTCDate()) : i.start.toISOString();
      const title = clean(text(ev.summary), 200);
      const description = clean(text(ev.description), 1500) || null;
      out.push({
        title, description, starts_at, ends_at: !i.allDay && i.end ? i.end.toISOString() : null,
        url: text(ev.url) || url, price: null, category: categoryFor(`${title} ${description ?? ""}`),
        venue_name: location, address: null, lat: geo?.lat ?? null, lng: geo?.lon ?? null, all_day: !!i.allDay,
      });
    }
  }
  return out.filter((e) => keep(e, opts, now)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, opts.max ?? 400);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Upcoming in-person events from a Localist calendar's API. */
export async function localistEvents(apiBase: string, opts: FeedOptions = {}): Promise<FeedEvent[]> {
  const base = apiBase.replace(/\/+$/, "").replace(/\/api\/2\/events$/, "") + "/api/2/events";
  const now = Date.now();
  const out: FeedEvent[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await get(`${base}?days=${Math.min(opts.days ?? 60, 365)}&pp=100&page=${page}`);
    const data = (await res.json()) as any;
    for (const { event: e } of (data.events ?? []) as any[]) {
      if (e.experience === "virtual") continue;
      if (opts.public_only) {
        const audience: string[] = (e.filters?.event_target_audience ?? e.filters?.event_audience ?? []).map((a: any) => String(a.name));
        if (audience.length && !audience.some((a) => /public|community|everyone|all\b|open/i.test(a))) continue;
      }
      const title = clean(String(e.title ?? ""), 200);
      const description = clean(String(e.description_text ?? ""), 1500) || null;
      for (const { event_instance: i } of (e.event_instances ?? []) as any[]) {
        out.push({
          title, description, starts_at: new Date(i.start).toISOString(), ends_at: i.end ? new Date(i.end).toISOString() : null,
          url: e.ticket_url || e.localist_url || e.url || base, price: e.free ? "Free" : clean(String(e.ticket_cost ?? ""), 60) || null,
          category: categoryFor(`${title} ${(e.filters?.event_types ?? []).map((t: any) => t.name).join(" ")} ${description ?? ""}`),
          venue_name: [e.location_name, e.room_number].filter(Boolean).join(", ") || null, address: e.address || null,
          lat: e.geo?.latitude ? Number(e.geo.latitude) : null, lng: e.geo?.longitude ? Number(e.geo.longitude) : null,
          all_day: !!i.all_day,
        });
      }
    }
    if (!data.page || data.page.current >= data.page.total) break;
  }
  return out.filter((e) => keep(e, opts, now)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, opts.max ?? 400);
}
