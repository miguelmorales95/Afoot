// Client-safe display helpers (no server imports).
import type { EventCategory } from "./types";

export const CATEGORY_META: Record<
  EventCategory,
  { label: string; emoji: string; className: string }
> = {
  music: { label: "Live Music", emoji: "🎸", className: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30" },
  karaoke: { label: "Karaoke", emoji: "🎤", className: "bg-pink-500/15 text-pink-300 ring-pink-500/30" },
  trivia: { label: "Games", emoji: "🧠", className: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  games: { label: "Games", emoji: "🧠", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  comedy: { label: "Comedy", emoji: "🎭", className: "bg-orange-500/15 text-orange-300 ring-orange-500/30" },
  market: { label: "Market", emoji: "🛍️", className: "bg-teal-500/15 text-teal-300 ring-teal-500/30" },
  food: { label: "Food", emoji: "🍽️", className: "bg-red-500/15 text-red-300 ring-red-500/30" },
  class: { label: "Class", emoji: "🎨", className: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  other: { label: "Event", emoji: "✨", className: "bg-violet-500/15 text-violet-300 ring-violet-500/30" },
};

export function categoryMeta(cat: string | null) {
  const key: EventCategory = cat && cat in CATEGORY_META ? (cat as EventCategory) : "other";
  return CATEGORY_META[key];
}

const TZ = "America/Los_Angeles";

/** e.g. "Sat, Mar 1" */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const fmt = (dd: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(dd);
  const tomorrow = new Date(today.getTime() + 86400000);
  if (fmt(d) === fmt(today)) return "Today";
  if (fmt(d) === fmt(tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** Group key stable per calendar day in LA time. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** e.g. "7:00 PM" */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDistance(km: number): string {
  const miles = km * 0.621371;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

export function milesFromKm(km: number): number {
  return km * 0.621371;
}

/** Numeric price for sorting: "Free"/null -> 0, "$15-25" -> 15, unknown -> Infinity. */
export function priceValue(price: string | null): number {
  if (price == null || price.trim() === "") return Infinity;
  if (/free|no cover/i.test(price)) return 0;
  const m = price.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : Infinity;
}

/** "Sat, Mar 1" compact date for table cells. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

// Words that carry no meaning on their own: articles, prepositions, pronouns, conjunctions,
// helper verbs and filler.
const FILLER = new Set(
  ("a an the at in on of for to from with by about into onto through over under during until till before after near against " +
    "between across around via per inside outside along within without upon off out up down " +
    "i you he she it we they me him her us them my your his its our their this that these those who whom whose which what " +
    "and or but nor so yet as if than while because " +
    "is are was were be been being will would can could may might shall should must do does did has have had " +
    "also just very more most all any each every some no not there here then now plus etc " +
    "event events held hosted host hosts join come enjoy featuring feature features presents presented " +
    "nothing something everything anything one own other others another such same " +
    // Generic verbs and question words: they read as noise once pulled out of a sentence.
    "bring brings make makes made get gets take takes spend spends invite invites play plays test chat stay stayed " +
    "matter matters learn see watch offer offers include includes including welcome welcomes encouraged available " +
    "open opens why where how when still always even ever really truly again " +
    // Words about the listing itself, not the event.
    "listing listings listed list given exact hour hours time times session sessions start starts recurring " +
    "details info information tba tbd website page " +
    // Street words are part of the location.
    "avenue ave street st boulevard blvd road rd drive dr way lane ln suite floor").split(" "),
);

// Dates and times are already on the card.
const WHEN = new Set(
  ("today tonight tomorrow all-day weekly daily nightly monthly week weeks weekend weekends day days night nights " +
    "am pm noon midnight morning afternoon evening runs run running through " +
    "january february march april may june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec " +
    "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun").split(" "),
);

// A sentence that describes the listing rather than the event.
const LISTING_NOTE = /\b(isn'?t|is not|not|aren'?t|wasn'?t)\s+(listed|given|provided|posted|shown|available|specified|confirmed)\b|\bdefault\b|\b(check|confirm) (the|with|their|its)\b|\b(tba|tbd)\b/i;

const norm = (w: string) => w.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
const stem = (w: string) => w.replace(/'s$/, "").replace(/(?<=..)s$/, "");
const wordsOf = (s: string | null | undefined) =>
  (s ?? "").split(/[\s\-/,.()&|:;!?"]+/).map(norm).filter(Boolean);

/**
 * Keywords for small screens: the event's tagline (or description) minus filler words and
 * minus anything the card already shows (title, venue, address, dates and times, tags,
 * category, repeat note), first `max` kept. Empty when fewer than two are left.
 */
export function briefWords(
  ev: {
    tagline?: string | null; description: string | null; title: string; venue_name: string; venue_address?: string | null;
    tags?: string[] | null; category: string | null; recurrence_description?: string | null; price?: string | null;
  },
  max = 6,
): string[] {
  const text = ev.tagline || ev.description;
  if (!text) return [];
  const shown = new Set<string>(["los", "angeles", "la", "ca"]);
  const cat = categoryMeta(ev.category);
  for (const w of [
    ...wordsOf(ev.title), ...wordsOf(ev.venue_name), ...wordsOf(ev.venue_address), ...wordsOf(cat.label),
    ...wordsOf(ev.category), ...wordsOf(ev.recurrence_description), ...wordsOf(ev.price), ...(ev.tags ?? []).flatMap(wordsOf),
  ]) {
    shown.add(w);
    shown.add(stem(w));
  }

  const out: string[] = [];
  const used = new Set<string>();
  // Sentences about the listing itself ("Start time isn't listed, so the default is used").
  const sentences = text.split(/(?<=[.!?])\s+/).filter((t) => !LISTING_NOTE.test(t));
  outer: for (const sentence of sentences) {
    const tokens = sentence.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const raw = tokens[i];
      const w = norm(raw);
      if (!w) continue;
      const s = stem(w);
      if (FILLER.has(w) || WHEN.has(w) || WHEN.has(s) || shown.has(w) || shown.has(s) || used.has(s)) continue;
      // Bare numbers, times and time ranges (7pm, 7:30, 3:00-4:30pm), dates (5th) and years.
      if (/^\d+([:.]\d+)?(am|pm|st|nd|rd|th|s)?$/.test(w) || /\d:\d|\d\s*(am|pm)\b/.test(w)) continue;
      if (w.length > 4 && w.endsWith("ly") && w !== "family") continue; // adverbs
      used.add(s);
      let word = raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%+]+$/gu, "");
      // A capital that only marks a sentence start goes; names and acronyms (mid-sentence caps) stay.
      if (i === 0 && /^\p{Lu}\p{Ll}/u.test(word)) word = word.toLowerCase();
      out.push(word);
      if (out.length >= max) break outer;
    }
  }
  return out.length >= 2 ? out : [];
}

/** A date range spanning days (an exhibit, a play's run, "photos with Santa through Dec 24"). */
export const isRun = (o: { starts_at: string; ends_at: string | null }) =>
  !!o.ends_at && Date.parse(o.ends_at) - Date.parse(o.starts_at) > 26 * 3600 * 1000;

/** True when most of a tagline's meaningful words are already in the title or venue name. */
export function repeatsCard(tagline: string, ev: { title: string; venue_name?: string | null }): boolean {
  const shown = new Set([...wordsOf(ev.title), ...wordsOf(ev.venue_name)].flatMap((w) => [w, stem(w)]));
  const words = wordsOf(tagline).filter((w) => !FILLER.has(w) && !/^\d+$/.test(w));
  if (!words.length) return true;
  const repeated = words.filter((w) => shown.has(w) || shown.has(stem(w))).length;
  return repeated / words.length >= 0.6;
}

/**
 * Whether we know there's parking: "parking" when the venue's note mentions a lot, garage,
 * valet or free parking; "no-parking" when it says there's none (or street only), or when two
 * or more people tipped "hard to park". Null when we don't know (assume street parking).
 */
export function parkingStatus(ev: { venue_parking?: string | null; heads_up?: Partial<Record<string, number>> }): "parking" | "no-parking" | null {
  const note = ev.venue_parking ?? "";
  if (/\bno (on-?site |dedicated |free )?parking\b|\bstreet (parking )?only\b|\bno (parking )?lot\b/i.test(note)) return "no-parking";
  if (/\b(lot|garage|structure|valet|free parking|parking (available|on-?site))\b/i.test(note)) return "parking";
  if ((ev.heads_up?.parking ?? 0) >= 2) return "no-parking";
  return null;
}

const TAG_ACRONYMS: Record<string, string> = { dj: "DJ", djs: "DJs", lgbtq: "LGBTQ", "lgbtq+": "LGBTQ+", rsvp: "RSVP", bipoc: "BIPOC", aapi: "AAPI", ai: "AI", la: "LA", byob: "BYOB", diy: "DIY", edm: "EDM", vr: "VR", asl: "ASL", stem: "STEM", rnb: "R&B", "r&b": "R&B", ipa: "IPA" };
// Hyphens that belong to the word ("all-ages", "hands-on"); other hyphens in a tag are slug joins.
const KEEP_HYPHEN = /-(friendly|on|ages|energy|up|in|through|off|night-only)$/;

/** A stored tag as people read it: "date-night" → "Date night", "dj" → "DJ", "all-ages" → "All-ages". */
const TAG_NAMES: Record<string, string> = { "dia-de-los-muertos": "Día de los Muertos", "dia de los muertos": "Día de los Muertos", "lunar new year": "Lunar New Year" };

export function formatTag(tag: string): string {
  if (TAG_NAMES[tag.toLowerCase()]) return TAG_NAMES[tag.toLowerCase()];
  const words = tag.split(/\s+/).flatMap((w) => (KEEP_HYPHEN.test(w) ? [w] : w.split("-")));
  const out = words.filter(Boolean).map((w) => TAG_ACRONYMS[w.toLowerCase()] ?? w);
  if (!out.length) return tag;
  out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
  return out.join(" ");
}

const DAY3: [RegExp, string][] = [
  [/\b(mondays?|mon)\b/gi, "MON"], [/\b(tuesdays?|tues?|tu)\b/gi, "TUE"], [/\b(wednesdays?|weds?)\b/gi, "WED"],
  [/\b(thursdays?|thurs?|thu|th)\b/gi, "THU"], [/\b(fridays?|frid?)\b/gi, "FRI"], [/\b(saturdays?|sat)\b/gi, "SAT"],
  [/\b(sundays?|sun)\b/gi, "SUN"],
];

/** "Every Tue & Thurs" → "TUE, THU"; "Fridays and Saturdays" → "FRI, SAT". */
export function normalizeSchedule(label: string): string {
  let s = label
    .replace(/([a-z])([A-Z])/g, "$1 $2") // "MonOfMonth" → "Mon Of Month"
    .replace(/\bevery\b|\b(evenings?|nights?|mornings?|afternoons?)\b/gi, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, " ");
  // "1st Sun of the month, monthly" → "1st Sun": the ordinal already says monthly.
  if (/\b(1st|2nd|3rd|4th|5th|last)\b/i.test(s)) s = s.replace(/\bof (the |each |every )?month\b|\bmonthly\b/gi, " ");
  for (const [re, d] of DAY3) s = s.replace(re, d);
  return s
    .replace(/\s*(&|\+|\band\b|\/)\s*/gi, ", ")
    .replace(/\s*,\s*(,\s*)*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .toUpperCase();
}

/**
 * The line under a card's time: the schedule and how long it runs, e.g. "MON, WED, FRI UNTIL 9/16"
 * or "WEEKLY UNTIL 10/13". `withUntil` is false when the time block already says "Until".
 */
export function scheduleLine(
  ev: { is_recurring?: boolean; schedule_label?: string | null; last_occurrence_date?: string | null },
  withUntil = true,
): string | null {
  const parts: string[] = [];
  const label = ev.is_recurring && ev.schedule_label ? normalizeSchedule(ev.schedule_label) : "";
  if (label && label !== "NULL") parts.push(label);
  if (withUntil && ev.last_occurrence_date) {
    const md = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "numeric", day: "numeric" }).format(new Date(ev.last_occurrence_date));
    parts.push(`UNTIL ${md}`);
  }
  return parts.length ? parts.join(" ") : null;
}
