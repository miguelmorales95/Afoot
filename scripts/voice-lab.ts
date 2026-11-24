// Voice lab: what event text would look like with Miguel's voice mixed in, three ways, on real
// days ranked the way the site ranks them (indie boost, lib/rank.ts). Read-only: nothing is saved
// to the database. Writes one self-contained page.
//   npm run voice:lab                       # Dec 3 and Dec 5 2026, Claude for the AI versions
//   npm run voice:lab -- out/dir 2026-12-10 2026-12-12
//
// The three ways, from least to most AI in his voice:
//   1 Margin note   the auto gist stays as is; the AI adds one short aside in his voice.
//   2 Rewrite       the AI rewrites the card's line in his voice (facts only from the listing).
//   3 His lines     no AI voice: he writes ~12 lines once (one per kind of event), picked by rule.
//                   The ones below are drafts in his style for him to replace with his own.
import "./env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { supabase } from "../lib/supabase";
import { completeJson, jsonObject } from "../lib/llm";
import { VOICE, VOICE_RULES } from "../lib/voice";
import { briefWords, formatTime } from "../lib/format";
import { INDIE_BOOST, venueScene, type Scene } from "../lib/rank";

// The voice notes and rules live in lib/voice.ts (the live card lines use the same ones).
const RULES = VOICE_RULES;

const DAY = 864e5;
const BOOST_LIVE = Date.parse("2026-11-25T00:00:00Z");
const CARDS = 12;

// Way 3: one line per kind of event. DRAFTS in his style; he should rewrite these himself.
const LINES: { when: (c: string, s: Scene) => boolean; line: string }[] = [
  { when: (c, s) => s === "institution", line: "Campus or city calendar pick. Usually low key, usually cheap." },
  { when: (c) => c === "music", line: "Small room, live band. This is the stuff I made this for." },
  { when: (c) => c === "comedy", line: "Comedy in a small room just hits different." },
  { when: (c) => c === "games" || c === "trivia", line: "Bring friends, or go make some there." },
  { when: (c) => c === "karaoke", line: "Somebody has to go first. Could be you." },
  { when: (c) => c === "class", line: "Learn a thing on a weeknight. Low pressure." },
  { when: (c) => c === "art", line: "Go look at stuff for an hour. Good night out, honestly." },
  { when: (c) => c === "market", line: "Walk around, eat something, buy one thing you don't need." },
  { when: (c) => c === "food", line: "Come hungry. That's pretty much the plan." },
  { when: () => true, line: "Auto-pulled, so tap through for the real details." },
];

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const laDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function all(table: string, cols: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(table).select(cols).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data as unknown as Row[]));
  }
  return out;
}

async function dayCards(day: string) {
  const start = new Date(`${day}T08:00:00Z`).getTime(); // LA midnight (PST)
  const { data: occ, error } = await supabase.from("event_occurrences").select("event_id,starts_at")
    .gte("starts_at", new Date(start).toISOString()).lt("starts_at", new Date(start + DAY).toISOString()).eq("cancelled", false).limit(2000);
  if (error) throw new Error(error.message);
  const evs = (await all("events", "id,title,description,tagline,category,tags,price,url,venue_id,traffic_score,traffic_scored_at,status,recurrence_description", [...new Set(occ.map((o) => o.event_id))]))
    .filter((e) => e.status === "active");
  const vs = new Map((await all("venues", "id,name,address,source,draw", [...new Set(evs.map((e) => e.venue_id))])).map((v) => [v.id, v]));
  const first = new Map<string, string>();
  for (const o of occ) if (laDay(o.starts_at) === day && (!first.has(o.event_id) || o.starts_at < first.get(o.event_id)!)) first.set(o.event_id, o.starts_at);

  // The site's order: score with the indie boost (added here if the nightly rank hasn't yet).
  const scored = evs.filter((e) => first.has(e.id) && vs.has(e.venue_id)).map((e) => {
    const v = vs.get(e.venue_id)!;
    const scene = venueScene(v as { name: string; source: string | null; draw: number | null }, e.url);
    const has = e.traffic_scored_at && Date.parse(e.traffic_scored_at) >= BOOST_LIVE;
    return { e, v, scene, score: Math.min(100, (e.traffic_score ?? 30) + (scene === "indie" && !has ? INDIE_BOOST : 0)) };
  }).sort((a, b) => b.score - a.score);
  // One card per venue + type, like the lineup cards on the site.
  const seen = new Set<string>(), cards: typeof scored = [];
  for (const x of scored) {
    const k = `${x.e.venue_id}|${x.e.category}`;
    if (seen.has(k)) continue;
    seen.add(k); cards.push(x);
    if (cards.length >= CARDS) break;
  }
  return cards.map(({ e, v, scene }) => ({
    id: e.id as string, title: e.title as string, venue: v.name as string, category: (e.category ?? "other") as string, scene,
    time: formatTime(first.get(e.id)!), price: e.price as string | null, description: (e.description ?? "") as string,
    gist: briefWords({ ...e, venue_name: v.name, venue_address: v.address } as Parameters<typeof briefWords>[0]),
    line: LINES.find((l) => l.when(e.category ?? "other", scene))!.line,
  }));
}

async function voiced(cards: { title: string; venue: string; category: string; description: string; gist: string[] }[]) {
  const system = `You write short lines for event cards on Light Pole, an LA events app run by one person.\n\n${VOICE}\n\n${RULES}\n
For each event write:
- "aside": a margin note in his voice, at most 8 words, that sits under the auto keywords (e.g. "kinda perfect for a Tuesday, honestly").
- "rewrite": the card's one line rewritten in his voice, at most 14 words, saying what it is and why you'd go.
If the listing says too little, keep it short and honest (e.g. "Listing's thin on details, tap through").
Return one entry per event, with i = the event's number.`;
  const schema = jsonObject({ lines: { type: "array", items: jsonObject({ i: { type: "integer" }, aside: { type: "string" }, rewrite: { type: "string" } }) } });
  const out: { aside: string; rewrite: string }[] = cards.map(() => ({ aside: "", rewrite: "" }));
  for (let b = 0; b < cards.length; b += 8) {
    const chunk = cards.slice(b, b + 8);
    const prompt = chunk.map((c, i) => `${i}. Title: ${c.title}\n   Venue: ${c.venue}\n   Type: ${c.category}\n   Keywords shown: ${c.gist.join(", ") || "(none)"}\n   Listing: ${c.description.slice(0, 700) || "(no description)"}`).join("\n\n");
    // Sonnet: tone is the whole point here, and it's a few dozen lines.
    const parsed = await completeJson<{ lines: { i: number; aside: string; rewrite: string }[] }>({ model: "claude-sonnet-5-5", system, prompt, schema, maxTokens: 2000 });
    for (const l of parsed.lines ?? []) if (chunk[l.i]) out[b + l.i] = { aside: l.aside ?? "", rewrite: l.rewrite ?? "" };
  }
  return out;
}

async function main() {
  const [outDir = "voice-lab", ...dayArgs] = process.argv.slice(2);
  const days = dayArgs.length ? dayArgs : ["2026-12-03", "2026-12-05"];
  const result: Record<string, unknown[]> = {};
  for (const day of days) {
    const cards = await dayCards(day);
    const v = await voiced(cards);
    result[day] = cards.map((c, i) => ({ ...c, description: c.description.slice(0, 220), aside: v[i].aside, rewrite: v[i].rewrite }));
    console.log(`${day}: ${cards.length} cards`);
  }
  mkdirSync(outDir, { recursive: true });
  const html = readFileSync(join(__dirname, "voice-lab.html"), "utf8")
    .replace("/*DATA*/null", JSON.stringify({ generated: new Date().toISOString(), voice: VOICE, days: result }).replace(/</g, "\\u003c"));
  writeFileSync(join(outDir, "voice-lab.html"), html);
  console.log(`Wrote ${outDir}/voice-lab.html`);
}

if (require.main === module) main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
