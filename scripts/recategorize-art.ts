// One-off: move upcoming events that are art, film or theater into the "art" category.
// They were filed as "other" (the extractor had no art category) or "class" (calendar feeds filed
// films and exhibitions as classes). Classes and workshops stay "class".
//   npm run recategorize-art -- --dry-run   # print, don't save
//   npm run recategorize-art

import "./env";

import { supabase } from "../lib/supabase";
import { complete, extractJson } from "../lib/llm";

const dryRun = process.argv.includes("--dry-run");
const BATCH = 20;

const SYSTEM = `You sort LA events. For each numbered event answer art: true if it is an art show,
exhibition, gallery opening, museum exhibit, film screening, movie night, theater, a play, a musical,
dance or ballet performance, or performance art. Answer false for classes, workshops and lessons
(even art or dance classes), talks, tours, concerts, opera, sports, markets, kids' storytime,
holiday gatherings and anything else.
Reply with JSON only: {"answers":[{"i":0,"art":true}]}`;

interface Row { id: string; title: string; description: string | null; category: string }

async function main() {
  const now = new Date().toISOString();
  const seen = new Map<string, Row>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("event_occurrences")
      .select("event:events!inner(id, title, description, category, status)")
      .gte("starts_at", now)
      .in("event.category", ["other", "class"])
      .eq("event.status", "active")
      .range(from, from + 999);
    if (error) throw error;
    for (const o of (data ?? []) as unknown as { event: Row }[]) seen.set(o.event.id, o.event);
    if (!data || data.length < 1000) break;
  }
  const rows = [...seen.values()];
  console.log(`${rows.length} upcoming "other"/"class" events to check.`);

  const toArt: Row[] = [];
  for (let b = 0; b < rows.length; b += BATCH) {
    const chunk = rows.slice(b, b + BATCH);
    const prompt = chunk.map((e, i) => `${i}. [${e.category}] ${e.title} — ${(e.description ?? "").slice(0, 200)}`).join("\n");
    try {
      const out = JSON.parse(extractJson(await complete({ system: SYSTEM, prompt, json: true, maxTokens: 1500, temperature: 0, provider: "anthropic" }))) as { answers?: { i: number; art: boolean }[] };
      for (const a of out.answers ?? []) if (a?.art && chunk[a.i]) toArt.push(chunk[a.i]);
    } catch (e) {
      console.warn(`  batch ${b / BATCH + 1}: skipped (${(e as Error).message})`);
    }
    process.stdout.write(`  ${Math.min(b + BATCH, rows.length)}/${rows.length}\r`);
  }
  console.log();
  for (const e of toArt) console.log(`  → art: [${e.category}] ${e.title}`);
  console.log(`${toArt.length} event(s) are art, film or theater.`);
  if (dryRun) return console.log("Dry run: nothing saved.");
  for (let i = 0; i < toArt.length; i += 200) {
    const { error } = await supabase.from("events").update({ category: "art" }).in("id", toArt.slice(i, i + 200).map((e) => e.id));
    if (error) throw error;
  }
  console.log(`Saved: ${toArt.length} moved to art.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
