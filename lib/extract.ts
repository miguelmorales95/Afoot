import { complete, extractJson } from "./llm";
import type { ExtractedEvent } from "./types";
import { repeatsCard } from "./format";

// Turn messy venue page text into structured events using an LLM.
//
// The key move: we ask the model to EXPAND recurrence into concrete dates
// (given today's date), so "Every 2nd & 4th Tuesday" becomes real datetimes
// we can sort into a feed. This same function will later accept newsletter
// email text instead of page text — the extraction prompt is source-agnostic.
// Runs on Claude or local Ollama depending on LLM_PROVIDER (see lib/llm.ts).

const SYSTEM = `You extract public events from the text of a venue's website (or newsletter).

You are given the venue name, today's date, the venue's local timezone, and raw page text.
Return ONLY events that real people could attend: live music, DJ sets, karaoke, trivia,
board/tabletop game nights, comedy, markets, classes, watch parties, themed parties, etc.
Ignore navigation, menus, hours, merch, generic marketing, and private-booking blurbs.

For EACH event, expand its schedule into concrete upcoming occurrences:
- One-off dated event -> a single occurrence.
- Recurring event (e.g. "Every Wednesday", "2nd & 4th Tuesday", "first Friday of the month")
  -> compute every occurrence from today through ~8 weeks out, as real dates. Also fill
  recurrence_description with the human-readable rule and set is_recurring true.
- If a date is given without a year, infer the correct year from today's date (never pick a
  past date; roll to the next sensible future one).
- If you cannot determine a specific date for an event, omit that event entirely.

Times: use the venue's local timezone. Output each occurrence start/end as an ISO 8601
string WITH the offset, e.g. "2026-03-01T18:00:00-08:00". If no end time is known, use null.
If a start time is unknown but the date is known, use T19:00:00 (a reasonable evening default).

category must be one of: music, karaoke, trivia, games, comedy, market, food, class, other.

tags: 2-5 short lowercase tags describing the VIBE and ACTIVITY only — what it feels like and
what you'd actually do. Help someone decide if it's their scene. Good tags:
outdoor, indoor, chill, lively, dancey, loud, cozy, intimate, high-energy, competitive,
beginner-friendly, all-ages, "21+", "18+", "free", "live band", dj, acoustic, "open mic",
seated, standing, "food available", "dog-friendly", date-night, solo-friendly, hands-on.
Do NOT use the category itself as a tag, and don't invent marketing phrases. Omit tags you
can't infer from the text rather than guessing.

tagline: at most 9 words that tell someone scrolling on a phone what this actually is or what
they'll do there, e.g. "Six local artists, photography and mixed media" or "Teams compete,
prizes for the top three". The card already shows the title, venue, neighborhood, date, time,
price and tags, so NEVER repeat any of those. No marketing words (amazing, unforgettable,
don't miss), no "join us". Use null if the text gives nothing beyond what the card shows.

schedule_label: for recurring events only, 1-3 words naming the pattern, e.g. "Daily",
"Weekdays", "Weekends", "Every Tue", "Tue & Thu", "1st Fridays", "Monthly". No times, no
exceptions, no dates. null for one-off events.

Respond with a single JSON object and NOTHING else:
{"events": [ {
  "title": string,
  "description": string | null,     // 1-2 sentences, no marketing fluff
  "category": string,
  "price": string | null,           // e.g. "Free", "$10", "$15-25", or null
  "url": string | null,             // event/detail link if present, else null
  "recurrence_description": string | null,
  "is_recurring": boolean,
  "tags": string[],                 // 2-5 vibe/activity tags, or []
  "tagline": string | null,         // <= 9 words, nothing the card already shows
  "schedule_label": string | null,  // recurring only: 1-3 words, e.g. "Weekdays"
  "occurrences": [ { "start": string, "end": string | null } ]
} ] }

If there are no real events, return {"events": []}.`;

export interface ExtractInput {
  venueName: string;
  pageText: string;
  sourceUrl: string;
  today: string; // YYYY-MM-DD
  timezone?: string; // IANA tz, default America/Los_Angeles
}

export async function extractEvents(
  input: ExtractInput,
): Promise<ExtractedEvent[]> {
  const tz = input.timezone || "America/Los_Angeles";
  const userContent = [
    `Venue: ${input.venueName}`,
    `Source URL: ${input.sourceUrl}`,
    `Today's date: ${input.today}`,
    `Venue timezone: ${tz}`,
    ``,
    `--- PAGE TEXT START ---`,
    input.pageText,
    `--- PAGE TEXT END ---`,
  ].join("\n");

  const text = await complete({
    system: SYSTEM,
    prompt: userContent,
    maxTokens: 16000,
    json: true,
  });

  let parsed: { events?: ExtractedEvent[] };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    // A busy calendar can run past the output limit: keep the events that came through whole.
    const salvaged = completeEvents(text);
    if (!salvaged.length) {
      console.error(`  could not parse model output for ${input.venueName}`);
      return [];
    }
    console.error(`  model output for ${input.venueName} was cut off: kept ${salvaged.length} complete event(s)`);
    parsed = { events: salvaged };
  }

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  // Keep only events that have at least one valid future-ish occurrence,
  // and normalize tags to a clean string array.
  return events
    .filter(
      (e) =>
        e &&
        typeof e.title === "string" &&
        Array.isArray(e.occurrences) &&
        e.occurrences.some((o) => o && typeof o.start === "string"),
    )
    .map((e) => ({
      ...e,
      tagline: ((t) => (t && !repeatsCard(t, { title: e.title, venue_name: input.venueName }) ? t : null))(cleanTagline(e.tagline)),
      schedule_label: e.is_recurring ? cleanScheduleLabel(e.schedule_label, e.recurrence_description) : null,
      tags: Array.isArray(e.tags)
        ? e.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 6)
        : [],
    }));
}

/** A tagline as the card shows it: trimmed, no closing period, null if missing or over 12 words. */
export function cleanTagline(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const s = t.trim().replace(/^["'“]+|["'”]+$/g, "").replace(/\.$/, "").trim();
  const words = s.split(/\s+/).filter(Boolean).length;
  return words >= 2 && words <= 12 ? s : null;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/**
 * A schedule label as the card shows it: 1-4 words, no times, and every weekday it names must
 * be in the source schedule (so "Every Monday" can't come back as "4th Fri"). Else null.
 */
export function cleanScheduleLabel(t: unknown, source?: string | null): string | null {
  if (typeof t !== "string") return null;
  const s = t.trim().replace(/\.$/, "");
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words < 1 || words > 4 || /\d:\d|\d\s*(am|pm)\b/i.test(s)) return null;
  if (source) {
    const src = source.toLowerCase(), lab = s.toLowerCase();
    if (DAYS.some((d) => new RegExp(`\\b${d}`).test(lab) && !src.includes(d))) return null;
    if (/weekend/.test(lab) && !/weekend/.test(src) && !(src.includes("sat") && src.includes("sun"))) return null;
    // "1st", "2nd", "last"… must match the schedule's own ordinal.
    const ORD: [RegExp, RegExp][] = [
      [/\b1st\b|\bfirst\b/, /\b1st\b|\bfirst\b/], [/\b2nd\b|\bsecond\b/, /\b2nd\b|\bsecond\b/],
      [/\b3rd\b|\bthird\b/, /\b3rd\b|\bthird\b/], [/\b4th\b|\bfourth\b/, /\b4th\b|\bfourth\b/], [/\blast\b/, /\blast\b/],
    ];
    if (ORD.some(([inLabel, inSrc]) => inLabel.test(lab) && !inSrc.test(src))) return null;
  }
  return s;
}

/** The whole event objects in an "events" array whose JSON was cut off partway. */
export function completeEvents(text: string): ExtractedEvent[] {
  const key = text.indexOf('"events"');
  const open = key === -1 ? -1 : text.indexOf("[", key);
  if (open === -1) return [];
  const out: ExtractedEvent[] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") { if (depth++ === 0) start = i; }
    else if (ch === "}" && --depth === 0 && start !== -1) {
      try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a malformed one */ }
      start = -1;
    } else if (ch === "]" && depth === 0) break;
  }
  return out;
}
