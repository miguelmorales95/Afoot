// Official calendar feeds: the public calendars of colleges, libraries, parks departments,
// museums and malls, read from the machine-readable feed they publish instead of scraping pages
// with the AI. Four kinds (event_feeds.kind):
//   ics       an iCalendar URL (Trumba, LiveWhale, LibCal, CivicPlus, Google Calendar,
//             WordPress "The Events Calendar" ?ical=1, Squarespace ?format=ical, Localist .ics…)
//   localist  a Localist calendar's API (https://calendar.example.edu/api/2/events): richer than
//             its iCal (place names, map pins, ticket links, in person or online)
//   civicplus a CivicPlus city calendar's RSS (…/RSSFeed.aspx?ModID=58&CID=All-calendar.xml), which
//             carries each event's dates, times and place
//   communico a Communico library calendar (https://library.libnet.info), read from its events JSON
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
  "planning (meeting|session)", "agenda", "(regular|special|adjourned) meeting", "(council|commission|board|committee)\\b.{0,30}\\bmeeting",
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

/** A wall-clock time in Los Angeles on a calendar date, as ISO with the offset (midnight by default). */
function laTime(y: number, m: number, d: number, h = 0, min = 0): string {
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(y).padStart(4, "0")}-${p(m)}-${p(d)}T${p(h)}:${p(min)}:00${laOffset(guess)}`;
}
const laMidnight = (y: number, m: number, d: number) => laTime(y, m, d);

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "val" in (v as object)) return String((v as { val: unknown }).val ?? "");
  return String(v);
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);
/** Feed text without tags, HTML entities ("&#39;", "&amp;") or extra spaces. */
const clean = (s: string, max: number) => decode(s.replace(/<[^>]+>/g, " ")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

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

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "November 5, 2026" → [2026, 11, 5]. */
function dateParts(s: string): [number, number, number] | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  return m && month ? [Number(m[3]), month, Number(m[2])] : null;
}
/** "07:30 PM" → [19, 30]. */
function clockParts(s: string): [number, number] | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return null;
  const h = Number(m[1]) % 12 + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return [h, Number(m[2])];
}
const tag = (item: string, name: string) => item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

/** Upcoming events in a CivicPlus city calendar's RSS. Entries that run for days (exhibits, drives) are skipped. */
export async function civicplusEvents(url: string, opts: FeedOptions = {}): Promise<FeedEvent[]> {
  const body = await (await get(url)).text();
  if (!body.includes("calendarEvent:EventDates")) throw new Error("not a CivicPlus calendar feed");
  const now = Date.now(), to = now + (opts.days ?? 60) * 86_400_000;
  const out: FeedEvent[] = [];
  for (const item of body.split("<item>").slice(1)) {
    const [first, last] = clean(tag(item, "calendarEvent:EventDates"), 80).split(/\s+-\s+/);
    const day = dateParts(first ?? "");
    if (!day || (last && last !== first)) continue;
    const [start, end] = clean(tag(item, "calendarEvent:EventTimes"), 40).split(/\s+-\s+/).map((t) => clockParts(t ?? ""));
    const starts_at = start ? laTime(...day, ...start) : laMidnight(...day);
    if (Date.parse(starts_at) > to) continue;
    // The description holds "Event dates … Location: <br>street<br>city … Description: <br>text".
    const html = decode(tag(item, "description"));
    const place = html.match(/Location:<\/strong>([\s\S]*?)(<strong>|$)/i)?.[1] ?? "";
    const location = place.split(/<br\s*\/?>/i).map((l) => clean(l, 120)).filter(Boolean).join(", ") || null;
    const title = clean(tag(item, "title"), 200);
    const description = clean(html.match(/Description:<\/strong>([\s\S]*)$/i)?.[1] ?? "", 1500) || null;
    out.push({
      title, description, starts_at, ends_at: start && end ? laTime(...day, ...end) : null,
      url: clean(tag(item, "link"), 500) || url, price: null, category: categoryFor(`${title} ${description ?? ""}`),
      venue_name: location, address: location, lat: null, lng: null, all_day: !start,
    });
  }
  return out.filter((e) => keep(e, opts, now)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, opts.max ?? 400);
}

/** Upcoming in-person events from a Communico library calendar (https://library.libnet.info). */
export async function communicoEvents(base: string, opts: FeedOptions = {}): Promise<FeedEvent[]> {
  const origin = new URL(base).origin;
  const now = Date.now();
  const req = { private: false, date: new Date(now).toISOString().slice(0, 10), days: opts.days ?? 60, locations: [], ages: [], types: [] };
  const data = (await (await get(`${origin}/eeventcaldata?event_type=0&req=${encodeURIComponent(JSON.stringify(req))}`)).json()) as any[];
  const out: FeedEvent[] = [];
  for (const e of Array.isArray(data) ? data : []) {
    if (e.private_event === "1" || e.event_type === "ONLINE" || /online/i.test(e.location ?? "") || e.changed_reason) continue;
    const m = String(e.event_start ?? "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!m) continue;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    const allDay = !e.start_time;
    const end = String(e.event_end ?? "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    const title = clean(String(e.title ?? ""), 200);
    const description = clean(String(e.description || e.long_description || ""), 1500) || null;
    out.push({
      title, description, starts_at: allDay ? laMidnight(y, mo, d) : laTime(y, mo, d, h, mi),
      ends_at: !allDay && end ? laTime(...(end.slice(1).map(Number) as [number, number, number, number, number])) : null,
      url: e.url || `${origin}/event/${e.id}`, price: Number(e.registration_cost) > 0 ? `$${e.registration_cost}` : "Free",
      category: categoryFor(`${title} ${e.tags ?? ""} ${description ?? ""}`),
      venue_name: clean(String(e.location ?? ""), 120) || null, address: null, lat: null, lng: null, all_day: allDay,
    });
  }
  return out.filter((e) => keep(e, opts, now)).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, opts.max ?? 400);
}
