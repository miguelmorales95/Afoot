// Load a local events CSV into Supabase (venues → events → occurrences).
// Idempotent: venues upsert by slug, events by dedupe_key, occurrences by
// (event_id, starts_at), so re-running after edits doesn't duplicate anything.
//   npm run import:csv -- --dry-run           # show what would be written
//   npm run import:csv                        # uses LOCAL_EVENTS_FILE
//   npm run import:csv -- data/other.csv

import "./env";

import fs from "node:fs";
import { supabase } from "../lib/supabase";
import { parseCsv, slugify, uncertainFields } from "../lib/localEvents";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--")) || process.env.LOCAL_EVENTS_FILE;
  if (!file) throw new Error("Pass a CSV path or set LOCAL_EVENTS_FILE in .env.local");

  const rows = parseCsv(fs.readFileSync(file, "utf8")).filter((r) => r.title && r.venue_name && r.starts_at);
  const venues = new Map<string, (typeof rows)[number]>();
  for (const r of rows) venues.set(slugify(r.venue_name), r);
  console.log(`${rows.length} event row(s) at ${venues.size} venue(s) in ${file}${dryRun ? " (dry run)" : ""}`);
  if (dryRun) return;

  const venueIds = new Map<string, string>();
  for (const [slug, r] of venues) {
    const { data, error } = await supabase
      .from("venues")
      .upsert(
        {
          slug,
          name: r.venue_name,
          address: r.venue_address || null,
          city: r.neighborhood || "Los Angeles",
          lat: r.venue_lat ? Number(r.venue_lat) : null,
          lng: r.venue_lng ? Number(r.venue_lng) : null,
          website: r.url || null,
          // "manual": researched one-offs; the daily ingest doesn't scrape these venues.
          source: "manual",
          active: true,
        },
        { onConflict: "slug" },
      )
      .select("id")
      .single();
    if (error || !data) { console.log(`  ! venue ${r.venue_name}: ${error?.message}`); continue; }
    venueIds.set(slug, data.id);
  }

  let written = 0;
  for (const r of rows) {
    const venueId = venueIds.get(slugify(r.venue_name));
    if (!venueId) continue;
    const { data: ev, error: evErr } = await supabase
      .from("events")
      .upsert(
        {
          venue_id: venueId,
          title: r.title,
          description: r.description || null,
          category: r.category || "other",
          price: r.price || null,
          url: r.url || r.source_url || null,
          recurrence_description: r.recurrence_description || null,
          is_recurring: r.is_recurring === "true",
          tags: r.tags ? r.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
          source: "manual",
          source_url: r.source_url || null,
          confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
          uncertain_fields: uncertainFields(r),
          notes: r.notes || null,
          verified_by: r.confidence === "high" ? "source" : null,
          dedupe_key: `${venueId}:${slugify(r.title)}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      )
      .select("id")
      .single();
    if (evErr || !ev) { console.log(`  ! event ${r.title}: ${evErr?.message}`); continue; }

    const { error: occErr } = await supabase
      .from("event_occurrences")
      .upsert({ event_id: ev.id, starts_at: r.starts_at, ends_at: r.ends_at || null }, { onConflict: "event_id,starts_at", ignoreDuplicates: true });
    if (occErr) console.log(`  ! occurrence ${r.title} ${r.starts_at}: ${occErr.message}`);
    else written++;
  }
  console.log(`Done. ${written} occurrence(s) written.`);
}

main().then(() => process.exit(0));
