// The card line in Miguel's voice ("Way 2: rewrite", picked in the voice lab, Nov 2026). Claude
// writes it from the listing, facts only; scripts/voice-lines.ts saves it to events.voice_line and
// the card shows it in place of the keyword gist. The voice notes are distilled from his own
// messages; edit them here and rerun `npm run voice-lines -- --all` to rewrite every line.
import { completeJson, jsonObject } from "./llm";

export const VOICE = `How Miguel writes (he runs Light Pole alone, LA local, not a writer):
- Like texting a friend: plain, direct, a little casual ("kinda", "pretty much", "honestly").
- Says what the thing is and why you'd go, then stops. Short.
- Honest and a bit self-aware; jokes at his own expense, never at the event's.
- No hype or marketing words (amazing, unforgettable, vibes, don't miss, curated).
- "lol" is rare: at most one in five lines.`;

export const VOICE_RULES = `Hard rules:
- Use only facts from the listing. Never invent prices, lineups, crowd, or what it's like.
- Don't tell people who to bring, what to wear or when to arrive unless the listing says so.
- Never claim Miguel has been there, knows the people, or recommends it personally.
- Don't repeat the title, venue, date, time or price (the card shows them).
- Never mention cost, start times or which days it runs, not even to say they're missing (the card handles that).
- No contact details, emails or links.
- No emoji, no hashtags.`;

// Sonnet: tone is the whole point.
export const VOICE_MODEL = "claude-sonnet-5-5";
export const VOICE_MAX_WORDS = 14;

export interface VoiceInput { title: string; venue: string; category: string; description: string; tagline?: string | null }

/** What a line was written from; when this changes (the listing was edited), the line is rewritten. */
export function voiceSource(e: VoiceInput): string {
  const s = [e.title, e.venue, e.category, e.tagline ?? "", e.description.slice(0, 700)].join("\n");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}

/** A line as the card shows it: one line, no closing period, null if empty or too long. */
export function cleanVoiceLine(t: string | null | undefined): string | null {
  const s = (t ?? "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!s || s.split(" ").length > VOICE_MAX_WORDS + 4) return null;
  return s;
}

/** One line per event, in order; null where Claude gave nothing usable. Batches of 10. */
export async function writeVoiceLines(evs: VoiceInput[]): Promise<(string | null)[]> {
  const system = `You write the one line on each event card on Light Pole, an LA events app run by one person.\n\n${VOICE}\n\n${VOICE_RULES}\n
For each event write "line": at most ${VOICE_MAX_WORDS} words, in his voice, saying what it is and why you'd go.
If the listing says too little, keep it short and honest (e.g. "Listing's thin on details, tap through").
Return one entry per event, with i = the event's number.`;
  const schema = jsonObject({ lines: { type: "array", items: jsonObject({ i: { type: "integer" }, line: { type: "string" } }) } });
  const out: (string | null)[] = evs.map(() => null);
  for (let b = 0; b < evs.length; b += 10) {
    const chunk = evs.slice(b, b + 10);
    const prompt = chunk.map((c, i) => `${i}. Title: ${c.title}\n   Venue: ${c.venue}\n   Type: ${c.category}\n   Listing: ${c.description.slice(0, 700) || c.tagline || "(no description)"}`).join("\n\n");
    const parsed = await completeJson<{ lines: { i: number; line: string }[] }>({ model: VOICE_MODEL, system, prompt, schema, maxTokens: 3000 });
    for (const l of parsed.lines ?? []) if (chunk[l.i]) out[b + l.i] = cleanVoiceLine(l.line);
  }
  return out;
}
