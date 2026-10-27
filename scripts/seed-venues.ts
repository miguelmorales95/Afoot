// Load a hand-picked venue list into the review queue (candidate_venues, status 'new'),
// so it shows up in /admin next to crawler finds. Approving there (or `npm run promote`)
// turns a row into a real venue that the daily ingest scrapes.
//   npm run seed:venues -- --dry-run            # print what would be added (reads only)
//   npm run seed:venues                         # uses data/la-venues.csv
//   npm run seed:venues -- data/other.csv
// Columns: name, website, events_url, address, neighborhood, city, categories (";"-separated),
// notes. Rows whose site is already a venue or a candidate are skipped, so re-running is safe.
// No AI, no web requests: this only writes rows.

import "./env";

import fs from "node:fs";
import { supabase } from "../lib/supabase";
import { parseCsv } from "../lib/localEvents";
import { registrableDomain } from "../lib/domain";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--")) || "data/la-venues.csv";
  const rows = parseCsv(fs.readFileSync(file, "utf8")).filter((r) => r.name && r.website);

  const known = new Set<string>();
  const { data: venues, error: vErr } = await supabase.from("venues").select("website");
  if (vErr) throw vErr;
  for (const v of venues ?? []) { const d = v.website && registrableDomain(v.website); if (d) known.add(d); }
  const { data: cands, error: cErr } = await supabase.from("candidate_venues").select("domain");
  if (cErr) throw cErr;
  for (const c of cands ?? []) if (c.domain) known.add(c.domain);

  const fresh = [];
  for (const r of rows) {
    const domain = registrableDomain(r.website);
    if (!domain) { console.log(`  ! ${r.name}: bad website "${r.website}"`); continue; }
    if (known.has(domain)) { console.log(`  = ${r.name}: already known (${domain}), skipping`); continue; }
    known.add(domain);
    fresh.push({
      domain,
      url: r.website,
      venue_name: r.name,
      neighborhood: r.neighborhood || null,
      city: r.city || "Los Angeles",
      address: r.address || null,
      events_url: r.events_url || null,
      categories: r.categories ? r.categories.split(";").map((c) => c.trim()).filter(Boolean) : [],
      score: 0.9, // hand-picked: sorts near the top of /admin; `promote --auto 0.9` approves them all
      reason: `Seed list (${file})${r.notes ? `: ${r.notes}` : ""}`.slice(0, 500),
      source_query: `seed:${file}`,
      status: "new",
    });
    console.log(`  + ${r.name} — ${r.events_url || r.website}${r.address ? "" : "  (no address: fill in before geocoding)"}`);
  }

  console.log(`\n${fresh.length} new of ${rows.length} row(s) in ${file}${dryRun ? " (dry run: nothing written)" : ""}.`);
  if (dryRun || fresh.length === 0) return;

  const { error } = await supabase.from("candidate_venues").upsert(fresh, { onConflict: "domain", ignoreDuplicates: true });
  if (error) throw error;
  console.log(`Added to the review queue. Review them in /admin, or: npm run promote -- --auto 0.9`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
