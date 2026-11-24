// Write short schedule labels ("Weekdays", "Every Tue") for recurring events that lack one
// (new imports get one from extraction).
//   npm run schedule-labels                 # all active recurring events without a label
//   npm run schedule-labels -- --dry-run
//   npm run schedule-labels -- --anthropic  # Claude instead of the local model

import "./env";

import { supabase } from "../lib/supabase";
import { complete, defaultProvider, extractJson } from "../lib/llm";
import { cleanScheduleLabel } from "../lib/extract";

const dryRun = process.argv.includes("--dry-run");
const provider = process.argv.includes("--anthropic") ? "anthropic" : defaultProvider();
const BATCH = 1; // bigger batches let the small local model swap answers between events

const SYSTEM = `You shorten event schedules for small labels on event cards. For each schedule,
write 1-3 words naming the pattern, e.g. "Daily", "Weekdays", "Weekends", "Every Tue",
"Tue & Thu", "1st Fridays", "Monthly", "Weekly". No times, no exceptions, no dates.
Use null if the schedule doesn't say how often it repeats.
Reply with JSON only: {"labels":[{"i":0,"label":"..." or null}]}`;

async function main() {
  const rows: { id: string; title: string; recurrence_description: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("events")
      .select("id, title, recurrence_description")
      .eq("status", "active")
      .eq("is_recurring", true)
      .is("schedule_label", null)
      .not("recurrence_description", "is", null)
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${rows.length} recurring events need a schedule label (${provider}).`);

  let saved = 0;
  for (let b = 0; b < rows.length; b += BATCH) {
    const chunk = rows.slice(b, b + BATCH);
    const prompt = chunk.map((e, i) => `${i}. ${e.title}: ${e.recurrence_description}`).join("\n");
    let reply: string | null = null;
    for (let attempt = 0; reply === null; attempt++) {
      try {
        reply = await complete({ system: SYSTEM, prompt, json: true, maxTokens: 1200, temperature: 0, provider });
      } catch (e) {
        if (attempt >= 8) throw e;
        console.warn(`  model unreachable (${(e as Error).message}); retrying in 15s`);
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
    let out: { labels?: ({ i: number; label: string | null } | null)[] } = {};
    try {
      out = JSON.parse(extractJson(reply));
    } catch (e) {
      console.warn(`  batch ${b / BATCH + 1}: unusable reply (${(e as Error).message}); skipped`);
      continue;
    }
    for (const x of out.labels ?? []) {
      const ev = x && chunk[x.i];
      const label = x && ev && cleanScheduleLabel(x.label, ev.recurrence_description);
      if (!ev || !label) continue;
      console.log(`  ${ev.recurrence_description.slice(0, 70)} → ${label}`);
      if (!dryRun) {
        const { error } = await supabase.from("events").update({ schedule_label: label }).eq("id", ev.id);
        if (error) console.warn(`  ! ${ev.title}: ${error.message}`);
        else saved++;
      }
    }
  }
  console.log(dryRun ? "Dry run: nothing saved." : `Saved ${saved} schedule label(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
