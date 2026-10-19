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
