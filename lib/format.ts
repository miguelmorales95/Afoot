// Client-safe display helpers (no server imports).
import type { EventCategory } from "./types";

export const CATEGORY_META: Record<
  EventCategory,
  { label: string; emoji: string; className: string }
> = {
  music: { label: "Live Music", emoji: "🎸", className: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30" },
  karaoke: { label: "Karaoke", emoji: "🎤", className: "bg-pink-500/15 text-pink-300 ring-pink-500/30" },
  trivia: { label: "Trivia", emoji: "🧠", className: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  games: { label: "Game Night", emoji: "🎲", className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
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
    "nothing something everything anything one " +
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

const norm = (w: string) => w.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
const stem = (w: string) => w.replace(/'s$/, "").replace(/(?<=..)s$/, "");
const wordsOf = (s: string | null | undefined) =>
  (s ?? "").split(/[\s\-/,.()&|:;!?"]+/).map(norm).filter(Boolean);

/**
 * A short description for small screens: the description minus filler words and minus
 * anything the card already shows (title, venue, address, dates and times, tags, category,
 * repeat note), first `max` words kept. Empty when fewer than two words are left: a lone
 * word ("Screening") says nothing the title doesn't.
 */
export function briefDescription(
  ev: {
    description: string | null; title: string; venue_name: string; venue_address?: string | null;
    tags?: string[] | null; category: string | null; recurrence_description?: string | null; price?: string | null;
  },
  max = 9,
): string {
  if (!ev.description) return "";
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
  for (const raw of ev.description.split(/\s+/)) {
    const w = norm(raw);
    if (!w) continue;
    const s = stem(w);
    if (FILLER.has(w) || WHEN.has(w) || WHEN.has(s) || shown.has(w) || shown.has(s) || used.has(s)) continue;
    // Bare numbers, times and time ranges (7pm, 7:30, 3:00-4:30pm), dates (5th) and years.
    if (/^\d+([:.]\d+)?(am|pm|st|nd|rd|th|s)?$/.test(w) || /\d:\d|\d\s*(am|pm)\b/.test(w)) continue;
    used.add(s);
    out.push(raw.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}%+]+$/gu, ""));
    if (out.length >= max) break;
  }
  return out.length >= 2 ? out.join(" ") : "";
}

/** A date range spanning days (an exhibit, a play's run, "photos with Santa through Dec 24"). */
export const isRun = (o: { starts_at: string; ends_at: string | null }) =>
  !!o.ends_at && Date.parse(o.ends_at) - Date.parse(o.starts_at) > 26 * 3600 * 1000;
