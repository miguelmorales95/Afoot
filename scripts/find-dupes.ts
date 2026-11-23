import { supabase } from "../lib/supabase";

async function findDuplicates() {
  // Find events with same venue + exact title (should only be 1 per dedupe_key)
  const { data: events, error } = await supabase
    .from("events")
    .select("id, venue_id, title, source, dedupe_key, created_at")
    .order("dedupe_key");

  if (error) {
    console.error("Error fetching events:", error);
    process.exit(1);
  }

  const byDedupeKey = new Map<string, any[]>();

  for (const ev of events || []) {
    if (!byDedupeKey.has(ev.dedupe_key)) {
      byDedupeKey.set(ev.dedupe_key, []);
    }
    byDedupeKey.get(ev.dedupe_key)!.push(ev);
  }

  console.log("🔍 Events with same dedupe_key (should not happen!):\n");
  let duplicateCount = 0;

  for (const [key, evs] of byDedupeKey) {
    if (evs.length > 1) {
      duplicateCount++;
      console.log(`\n[${duplicateCount}] "${evs[0].title}"`);
      console.log(`    Dedupe key: ${key}`);
      console.log(`    Count: ${evs.length} copies in DB`);
      for (let i = 0; i < evs.length; i++) {
        console.log(`      ${i + 1}. ID: ${evs[i].id} | Source: ${evs[i].source} | Created: ${evs[i].created_at}`);
      }
    }
  }

  console.log(`\n\n📊 Total: ${duplicateCount} event(s) with duplicate database records\n`);

  if (duplicateCount > 0) {
    console.log("⚠️  This should not happen! Dedupe_key is UNIQUE. Check data integrity.");
  }
}

findDuplicates().catch(console.error);
