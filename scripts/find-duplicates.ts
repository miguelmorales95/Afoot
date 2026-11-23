import { supabase } from "@/lib/supabase";

async function findDuplicates() {
  // Find events with same venue + similar title
  const { data: events, error } = await supabase
    .from("events")
    .select("id, venue_id, title, source, created_at, updated_at, dedupe_key")
    .order("venue_id")
    .order("title");

  if (error) {
    console.error("Error fetching events:", error);
    process.exit(1);
  }

  const byVenueAndTitle = new Map<string, any[]>();

  for (const ev of events || []) {
    const key = `${ev.venue_id}:${ev.title.toLowerCase().trim()}`;
    if (!byVenueAndTitle.has(key)) {
      byVenueAndTitle.set(key, []);
    }
    byVenueAndTitle.get(key)!.push(ev);
  }

  console.log("🔍 Duplicate events found:\n");
  let duplicateCount = 0;

  for (const [key, evs] of byVenueAndTitle) {
    if (evs.length > 1) {
      duplicateCount++;
      console.log(`\n[${duplicateCount}] ${evs[0].title}`);
      console.log(`    Venue: ${evs[0].venue_id}`);
      console.log(`    Count: ${evs.length} copies`);
      console.log(`    IDs: ${evs.map(e => e.id).join(", ")}`);
      console.log(`    Sources: ${evs.map(e => e.source).join(", ")}`);
      console.log(`    Dedupe keys: ${evs.map(e => e.dedupe_key).join(" | ")}`);
    }
  }

  console.log(`\n\n📊 Summary: ${duplicateCount} event(s) with duplicate entries`);
}

findDuplicates();
