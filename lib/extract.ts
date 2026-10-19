import { complete, extractJson } from "./llm";
import type { ExtractedEvent } from "./types";

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
    maxTokens: 8000,
    json: true,
  });

  let parsed: { events?: ExtractedEvent[] };
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    console.error(`  could not parse model output for ${input.venueName}`);
    return [];
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
      tags: Array.isArray(e.tags)
        ? e.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 6)
        : [],
    }));
}
