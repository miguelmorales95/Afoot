/**
 * Remove duplicate occurrences: keep one, delete rest with same start time.
 * Usage: npm run dedupe-occurrences [--dry-run] [--verbose]
 */

import "./env";

import { supabase } from "../lib/supabase";

const dryRun = process.argv.includes("--dry-run");
const verbose = process.argv.includes("--verbose");

async function dedupeOccurrences() {
  console.log(`🔍 Finding duplicate occurrences... ${dryRun ? "(DRY RUN)" : ""}\n`);

  // Get all occurrences grouped by event + start time
  const { data: occs, error } = await supabase
    .from("event_occurrences")
    .select("id, event_id, starts_at, created_at")
    .order("event_id")
    .order("starts_at")
    .order("created_at");

  if (error || !occs) {
    console.error("Error fetching occurrences:", error);
    process.exit(1);
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
}

dedupeOccurrences().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
