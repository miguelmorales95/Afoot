/**
 * Remove duplicate occurrences: keep one, delete rest with same start time.
 * Usage: npm run dedupe-occurrences [--dry-run] [--verbose]
 */

import "./env";

import { supabase } from "../lib/supabase";
import { isRun } from "../lib/format";

const dryRun = process.argv.includes("--dry-run");
const verbose = process.argv.includes("--verbose");

async function dedupeOccurrences() {
  console.log(`🔍 Finding duplicate occurrences... ${dryRun ? "(DRY RUN)" : ""}\n`);

  // Every page: the database returns at most 1,000 rows per request.
  const occs: { id: string; event_id: string; starts_at: string; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("event_occurrences")
      .select("id, event_id, starts_at, created_at")
      .order("event_id")
      .order("starts_at")
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) {
      console.error("Error fetching occurrences:", error);
      process.exit(1);
    }
    occs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byEventAndTime = new Map<string, any[]>();

  for (const occ of occs) {
    const key = `${occ.event_id}:${occ.starts_at}`;
    if (!byEventAndTime.has(key)) {
      byEventAndTime.set(key, []);
    }
    byEventAndTime.get(key)!.push(occ);
  }

  let deleteCount = 0;
  const toDelete: string[] = [];

  for (const [key, occList] of byEventAndTime) {
    if (occList.length > 1) {
      deleteCount += occList.length - 1;
      // Keep first (oldest), delete rest
      for (let i = 1; i < occList.length; i++) {
        toDelete.push(occList[i].id);
        if (verbose) {
          console.log(`  DUPLICATE: ${occList[0].event_id} at ${occList[0].starts_at}`);
          console.log(`    Keep: ${occList[0].id}`);
          console.log(`    Delete: ${occList[i].id}`);
        }
      }
    }
  }

  if (toDelete.length) {
    console.log(`\n🗑️  Deleting ${toDelete.length} duplicate occurrence(s)...\n`);

    if (!dryRun) {
      await supabase.from("event_occurrences").delete().in("id", toDelete);
      console.log(`✓ Deleted ${toDelete.length} occurrences`);
    } else {
      console.log(`(not applied in dry-run mode)`);
    }
  }

  console.log(`\n📊 Summary:\n    Total duplicates: ${deleteCount}\n    ${dryRun ? "DRY RUN" : "✓ Cleaned up"}`);

  await mergeRepeatedRuns();
}

/**
 * The same multi-day run saved again on later days ("through Dec 24" read on Nov 20, 21, 23):
 * keep the earliest, give it the latest end date, delete the later copies. Copies someone
 * RSVP'd to or chatted on are left alone.
 */
async function mergeRepeatedRuns() {
  const rows: { id: string; event_id: string; starts_at: string; ends_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("event_occurrences")
      .select("id, event_id, starts_at, ends_at")
      .not("ends_at", "is", null)
      .order("starts_at")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byEvent = new Map<string, typeof rows>();
  for (const r of rows.filter(isRun)) (byEvent.get(r.event_id) ?? byEvent.set(r.event_id, []).get(r.event_id)!).push(r);

  const toDelete: string[] = [];
  const newEnds = new Map<string, string>();
  for (const runs of byEvent.values()) {
    const kept: typeof rows = [];
    for (const r of runs) {
      const t = Date.parse(r.starts_at);
      const home = kept.find((k) => t < Date.parse(newEnds.get(k.id) ?? k.ends_at!));
      if (!home) { kept.push(r); continue; }
      toDelete.push(r.id);
      if (Date.parse(r.ends_at!) > Date.parse(newEnds.get(home.id) ?? home.ends_at!)) newEnds.set(home.id, r.ends_at!);
      if (verbose) console.log(`  RUN COPY: ${r.event_id} ${r.starts_at} (kept ${home.starts_at})`);
    }
  }

  const [going, chat] = toDelete.length
    ? await Promise.all([
        supabase.from("rsvps").select("occurrence_id").in("occurrence_id", toDelete),
        supabase.from("messages").select("occurrence_id").in("occurrence_id", toDelete),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (going.error || chat.error) throw new Error("couldn't check RSVPs/chat; nothing deleted");
  const used = new Set([...(going.data ?? []), ...(chat.data ?? [])].map((r) => r.occurrence_id as string));
  const safe = toDelete.filter((id) => !used.has(id));

  console.log(`\n🔁 Repeated runs: ${toDelete.length} later copies across ${byEvent.size} multi-day events` +
    `${used.size ? ` (${used.size} kept: they have RSVPs or chat)` : ""}`);
  if (dryRun) { console.log("(not applied in dry-run mode)"); return; }
  for (const [id, ends_at] of newEnds) await supabase.from("event_occurrences").update({ ends_at }).eq("id", id);
  for (let i = 0; i < safe.length; i += 200) await supabase.from("event_occurrences").delete().in("id", safe.slice(i, i + 200));
  console.log(`✓ Deleted ${safe.length}, extended ${newEnds.size} kept run(s) to the latest end date`);
}

dedupeOccurrences().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
