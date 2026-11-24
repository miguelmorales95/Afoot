// Writes the card line in Miguel's voice (lib/voice.ts) for upcoming events that don't have one,
// or whose listing changed since. Runs nightly after the rank (ingest.yml); new events get theirs then.
//   npm run voice-lines                  # next 30 days, only what's missing or stale
//   npm run voice-lines -- --days 7      # a shorter window
//   npm run voice-lines -- --all         # rewrite every line in the window (after editing the voice)
//   npm run voice-lines -- --dry-run     # print, don't save
import "./env";
import { supabase } from "../lib/supabase";
import { voiceSource, writeVoiceLines, type VoiceInput } from "../lib/voice";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run"), all = args.includes("--all");
const days = args.includes("--days") ? Number(args[args.indexOf("--days") + 1]) : 30;

async function byIds(table: string, cols: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from(table).select(cols).in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data as unknown as Row[]));
  }
  return out;
}

async function main() {
  const ids = new Set<string>();
  const to = new Date(Date.now() + days * 864e5).toISOString();
  for (let n = 0; ; n += 1000) {
    const { data, error } = await supabase.from("event_occurrences").select("event_id")
      .gte("starts_at", new Date().toISOString()).lt("starts_at", to).eq("cancelled", false).order("starts_at").range(n, n + 999);
    if (error) throw new Error(error.message);
    for (const o of data) ids.add(o.event_id);
    if (data.length < 1000) break;
  }
  const evs = (await byIds("events", "id,title,description,tagline,category,status,venue_id,voice_line,voice_line_src", [...ids])).filter((e) => e.status === "active");
  const venues = new Map((await byIds("venues", "id,name", [...new Set(evs.map((e) => e.venue_id as string))])).map((v) => [v.id, v.name as string]));
  const todo: { id: string; input: VoiceInput; src: string }[] = [];
  for (const e of evs) {
    const input: VoiceInput = { title: e.title, venue: venues.get(e.venue_id) ?? "", category: e.category ?? "other", description: e.description ?? "", tagline: e.tagline };
    const src = voiceSource(input);
    if (all || !e.voice_line || e.voice_line_src !== src) todo.push({ id: e.id, input, src });
  }
  console.log(`${evs.length} upcoming events in ${days} days; ${todo.length} need a line.`);
  let saved = 0, failed = 0;
  for (let b = 0; b < todo.length; b += 50) {
    const chunk = todo.slice(b, b + 50);
    let lines: (string | null)[];
    try { lines = await writeVoiceLines(chunk.map((t) => t.input)); } catch (e) { console.warn(`  batch failed: ${(e as Error).message}`); failed += chunk.length; continue; }
    for (let i = 0; i < chunk.length; i++) {
      const line = lines[i];
      if (!line) { failed++; continue; }
      if (dryRun) { console.log(`  ${chunk[i].input.title} → ${line}`); continue; }
      const { error } = await supabase.from("events").update({ voice_line: line, voice_line_src: chunk[i].src }).eq("id", chunk[i].id);
      if (error) { console.warn(`  ${chunk[i].input.title}: ${error.message}`); failed++; } else saved++;
    }
    if (!dryRun) console.log(`  ${Math.min(b + 50, todo.length)}/${todo.length}`);
  }
  console.log(dryRun ? "Dry run: nothing saved." : `Saved ${saved} line(s)${failed ? `, ${failed} skipped` : ""}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
