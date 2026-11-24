// The somedude paste importer (/somedude): a trusted local pastes an events page (Facebook's
// Events tab, or any listing site with no API) and the events go straight onto the pole.
//   1. The page (in the browser) turns the pasted or saved page into short "cards" of text with
//      their links (lib/pageCards.ts), so only a little text is sent here.
//   2. parse: Claude (Haiku) reads the cards into events; each is checked against what's already
//      on the pole (same day, similar title) and marked new / already / skipped.
//   3. add: the new ones are stored like links people send (source "link"), each at its venue
//      (found or created by name, geocoded from the address), then ranked and given their voice
//      line right away (finishNow), so a morning paste is ranked that morning.
// No quality filter yet: somedudes are trusted, so what they paste goes on. Add one before anyone
// untrusted gets this page.
import type { NextRequest } from "next/server";
import { supabase } from "./supabase";
import { completeJson, jsonObject } from "./llm";
import { similarTitles } from "./dedupe";
import { dayKey } from "./format";
import { todayISODate } from "./ingest";
import { voiceSource, writeVoiceLines, type VoiceInput } from "./voice";
import type { EventCategory, ExtractedEvent } from "./types";

export interface Somedude { email: string; area: string }

/** The signed-in somedude behind this request (Supabase access token as a Bearer), or null. */
export async function somedudeFor(req: NextRequest): Promise<Somedude | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) return null;
  const { data: row } = await supabase.from("somedudes").select("email, area").eq("email", email).maybeSingle();
  return (row as Somedude | null) ?? null;
}

export interface PastedEvent {
  title: string;
  /** ISO with offset; a 7 PM placeholder when time_unknown. */
  start: string;
  time_unknown: boolean;
  venue: string;
  address: string;
  city: string;
  category: EventCategory;
  url: string;
  description: string;
  /** Facebook's "interested" count when the page shows it, else null. */
  interested: number | null;
  going: number | null;
  status: "new" | "already" | "skipped";
  /** Why it's already on the pole or skipped. */
  why?: string;
}

const CATEGORIES: EventCategory[] = ["music", "karaoke", "trivia", "games", "comedy", "market", "food", "class", "art", "other"];
const MODEL = process.env.EXTRACTION_MODEL || "claude-haiku-5-5";

// Offset of Los Angeles time at a given instant, as "-08:00" / "-07:00".
const OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "longOffset" });
function laIso(date: string, time: string): string {
  const off = OFFSET.formatToParts(new Date(`${date}T${time}:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-08:00";
  return `${date}T${time}:00${off === "" ? "+00:00" : off}`;
}

/** Cards → events, via Claude. Cards are short text blocks, each with the link(s) found in it. */
async function readCards(cards: { text: string; url: string | null }[]): Promise<Omit<PastedEvent, "status" | "why">[]> {
  const today = todayISODate();
  const system = `You read events from text copied off an events listing page (often Facebook's Events tab) for an LA events app.
Today is ${today} (America/Los_Angeles). Each numbered card is one listing, or a chunk of a page that may hold several.
For every real, dated event return:
- title: the event's name, cleaned up (fix obvious typos only if certain; no dates in it)
- date: YYYY-MM-DD (a date without a year is the next one on or after today); time: HH:MM 24h, or "" if not given
- venue: the specific place name if given ("Peacock Theater"), else ""; address: street address if given, else ""
- city: the city or neighborhood ("Redondo Beach"), or "" if unknown
- online: true only for online-only events
- category: one of ${CATEGORIES.join(", ")} (trivia = trivia/quiz; games = board/video games, bingo; class = classes, workshops, talks, tours; art = galleries, film, theater; market = markets, fairs, festivals with vendors)
- url: the event's own link from the card (prefer facebook.com/events/<id> or the event page), or ""
- description: one plain sentence from the card's own words, or "" if the card has none
- interested / going: Facebook's counts as integers ("1.4K" = 1400), or -1 if not shown
Skip notifications, ads, people, pages and anything without a date. Don't invent anything not in the text.`;
  const prompt = cards.map((c, i) => `${i}. ${c.text}${c.url ? `\n   link: ${c.url}` : ""}`).join("\n\n");
  const schema = jsonObject({
    events: {
      type: "array",
      items: jsonObject({
        title: { type: "string" }, date: { type: "string" }, time: { type: "string" },
        venue: { type: "string" }, address: { type: "string" }, city: { type: "string" },
        online: { type: "boolean" }, category: { type: "string", enum: CATEGORIES },
        url: { type: "string" }, description: { type: "string" },
        interested: { type: "integer" }, going: { type: "integer" },
      }),
    },
  });
  type Raw = { title: string; date: string; time: string; venue: string; address: string; city: string; online: boolean; category: EventCategory; url: string; description: string; interested: number; going: number };
  const out = await completeJson<{ events: Raw[] }>({ model: MODEL, system, prompt, schema, maxTokens: 12000 });
  return (out.events ?? [])
    .filter((e) => e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !e.online)
    .map((e) => {
      const timeOk = /^\d{1,2}:\d{2}$/.test(e.time);
      return {
        title: e.title.trim().slice(0, 200),
        start: laIso(e.date, timeOk ? e.time.padStart(5, "0") : "19:00"),
        time_unknown: !timeOk,
        venue: e.venue.trim(), address: e.address.trim(), city: e.city.trim(),
        category: CATEGORIES.includes(e.category) ? e.category : "other",
        url: e.url.trim(), description: e.description.trim(),
        interested: e.interested >= 0 ? e.interested : null, going: e.going >= 0 ? e.going : null,
      };
    });
}

/** Is this already on the pole? Same LA day and a similar title, at any venue. */
async function alreadyOnPole(e: { title: string; start: string }): Promise<string | null> {
  const t = Date.parse(e.start);
  const { data } = await supabase.from("event_occurrences")
    .select("starts_at, event:events!inner(title, status, venue:venues(name))")
    .gte("starts_at", new Date(t - 30 * 3600e3).toISOString()).lte("starts_at", new Date(t + 30 * 3600e3).toISOString())
    .eq("cancelled", false).limit(1000);
  const day = dayKey(e.start);
  for (const o of (data ?? []) as unknown as { starts_at: string; event: { title: string; status: string; venue: { name: string } | null } }[]) {
    if (o.event.status !== "active" || dayKey(o.starts_at) !== day) continue;
    if (similarTitles(o.event.title, e.title)) return `"${o.event.title}" at ${o.event.venue?.name ?? "a venue"}`;
  }
  return null;
}

/** parse: cards → events, each marked new / already on the pole / skipped. */
export async function parseCards(cards: { text: string; url: string | null }[]): Promise<PastedEvent[]> {
  const evs = await readCards(cards);
  const seen = new Set<string>();
  const out: PastedEvent[] = [];
  for (const e of evs) {
    const key = `${dayKey(e.start)}:${e.title.toLowerCase()}`;
    if (seen.has(key)) continue; // the same listing twice on one page
    seen.add(key);
    if (Date.parse(e.start) < Date.now() - 6 * 3600e3) { out.push({ ...e, status: "skipped", why: "already happened" }); continue; }
    out.push({ ...e, status: "new" });
  }
  await Promise.all(out.map(async (e) => {
    if (e.status !== "new") return;
    const have = await alreadyOnPole(e);
    if (have) Object.assign(e, { status: "already", why: have });
  }));
  return out;
}

/** add: store events as if someone had sent their links. Returns per event: added, or why not. */
export async function addPasted(evs: PastedEvent[]): Promise<{ title: string; ok: boolean; note: string }[]> {
  const { venueFor } = await import("./venueMatch");
  const { geocode } = await import("./geocode");
  const { storeExtractedEvents } = await import("./ingest");
  const results: { title: string; ok: boolean; note: string }[] = [];
  const stored: { id: string; input: VoiceInput }[] = [];
  for (const e of evs) {
    try {
      if (await alreadyOnPole(e)) { results.push({ title: e.title, ok: false, note: "already on the pole" }); continue; }
      // A city alone isn't a venue: name it after the address or the city, so it can be fixed later.
      const name = e.venue || e.address.split(",")[0] || `${e.city || "LA"} (place to confirm)`;
      const address = e.address || [e.venue, e.city, "CA"].filter(Boolean).join(", ");
      // Locate it first, so an address-only listing lands on the venue we already have there (~60 m).
      const geo = e.address ? await geocode(e.address).catch(() => null) : null;
      const venueId = await venueFor({ name, address, lat: geo?.lat ?? null, lng: geo?.lng ?? null, source: "link" });
      // The venue's own name (an address can land on a venue we already had), as the nightly run sees it.
      const { data: v } = await supabase.from("venues").select("name").eq("id", venueId).maybeSingle();
      const venueName = (v?.name as string | undefined) ?? name;
      const ev: ExtractedEvent = {
        title: e.title, description: e.description || null, category: e.category, price: null, url: e.url || null,
        recurrence_description: null, is_recurring: false, tags: [], time_unknown: e.time_unknown,
        occurrences: [{ start: e.start, end: null }],
      } as ExtractedEvent;
      const n = await storeExtractedEvents({
        venueId, events: [ev], source: "link", fallbackUrl: e.url || null,
        onStored: (id) => stored.push({ id, input: { title: e.title, venue: venueName, category: e.category, description: e.description || "", tagline: null } }),
      });
      results.push({ title: e.title, ok: n > 0, note: n > 0 ? `added at ${venueName}` : "matched an event already at that venue" });
    } catch (err) {
      results.push({ title: e.title, ok: false, note: (err as Error).message });
    }
  }
  await finishNow(stored);
  return results;
}

/**
 * What the nightly run would do for these events, done now so they don't wait a day: the traffic
 * score (same formula, small-spot boost included) and the card line in Miguel's voice. Neither is
 * required to show the event: a failure here leaves it for the nightly run.
 */
async function finishNow(stored: { id: string; input: VoiceInput }[]) {
  if (!stored.length) return;
  const { rankEvents } = await import("./rankRun");
  const quiet = () => {};
  await Promise.all([
    rankEvents({ eventIds: stored.map((s) => s.id), log: quiet }).catch(() => null),
    writeVoiceLines(stored.map((s) => s.input)).then((lines) => Promise.all(lines.map((line, i) => line
      ? supabase.from("events").update({ voice_line: line, voice_line_src: voiceSource(stored[i].input) }).eq("id", stored[i].id)
      : null))).catch(() => null),
  ]);
}
