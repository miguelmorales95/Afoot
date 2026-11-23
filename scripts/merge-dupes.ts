/**
 * Find and merge duplicate events (same venue + similar title + same time).
 * Keeps the first event, merges all occurrences into it, deletes duplicates.
 *
 * Usage: npm run merge-dupes [--dry-run] [--verbose]
 */

import { supabase } from "../lib/supabase";

const dryRun = process.argv.includes("--dry-run");
const verbose = process.argv.includes("--verbose");

function normTitle(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sameTitle(a: string, b: string): boolean {
  const x = normTitle(a),
    y = normTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)));
}

async function mergeDuplicates() {
  console.log(`🔧 Finding duplicate events... ${dryRun ? "(DRY RUN)" : ""}\n`);

  // Fetch all events
  const { data: events, error } = await supabase
    .from("events")
    .select("id, venue_id, title, source, status")
    .eq("status", "active");

  if (error || !events) {
    console.error("Error fetching events:", error);
    process.exit(1);
  }

  // Group by venue
  const byVenue = new Map<string, any[]>();
  for (const ev of events) {
    if (!byVenue.has(ev.venue_id)) {
      byVenue.set(ev.venue_id, []);
    }
    byVenue.get(ev.venue_id)!.push(ev);
  }

  let mergedCount = 0;
  let deletedCount = 0;

  // Check each venue for duplicates
  for (const [venueId, venueEvents] of byVenue) {
    for (let i = 0; i < venueEvents.length; i++) {
      for (let j = i + 1; j < venueEvents.length; j++) {
        const ev1 = venueEvents[i];
        const ev2 = venueEvents[j];

        if (!sameTitle(ev1.title, ev2.title)) continue;

        // Check if they have overlapping occurrences
        const { data: occ1 } = await supabase
          .from("event_occurrences")
          .select("starts_at")
          .eq("event_id", ev1.id)
          .eq("cancelled", false);

        const { data: occ2 } = await supabase
          .from("event_occurrences")
          .select("starts_at")
          .eq("event_id", ev2.id)
          .eq("cancelled", false);

        if (!occ1 || !occ2) continue;

        const times1 = new Set(occ1.map((o: any) => Math.floor(Date.parse(o.starts_at) / 3600000))); // hour granularity
        const times2 = new Set(occ2.map((o: any) => Math.floor(Date.parse(o.starts_at) / 3600000)));

        const hasOverlap = [...times1].some((t) => times2.has(t));

        if (!hasOverlap) continue;

        // Found duplicates! Merge ev2 into ev1
        mergedCount++;
        console.log(
          `\n[${mergedCount}] MERGE "${ev1.title}" (${venueId})\n` +
            `    Keep: ${ev1.id} (source: ${ev1.source})\n` +
            `    Delete: ${ev2.id} (source: ${ev2.source})`
        );

        if (!dryRun) {
          // Move all occurrences from ev2 to ev1
          await supabase.from("event_occurrences").update({ event_id: ev1.id }).eq("event_id", ev2.id);

          // Delete ev2
          await supabase.from("events").delete().eq("id", ev2.id);

          deletedCount++;
          if (verbose) console.log(`    ✓ Merged and deleted`);
        } else if (verbose) {
          console.log(`    (not applied in dry-run mode)`);
        }

        // Remove ev2 from the list so we don't compare it again
        venueEvents.splice(j, 1);
        j--;
      }
    }
  }

  console.log(
    `\n\n📊 Summary:\n` +
      `    Duplicates found: ${mergedCount}\n` +
      `    Events deleted: ${deletedCount}\n` +
      `    ${dryRun ? "DRY RUN - no changes made" : "✓ Merged successfully"}`
  );
}

mergeDuplicates().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
