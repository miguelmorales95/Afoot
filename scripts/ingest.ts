// Ingest pipeline CLI.
//   npm run ingest                      # all active venues
//   npm run ingest -- smog-city-torrance  # just one (by slug)

import { config } from "dotenv";
config({ path: ".env.local" });

import { ingestAll } from "../lib/ingest";

async function main() {
  const onlySlug = process.argv[2];
  console.log(`Ingesting${onlySlug ? ` "${onlySlug}"` : " all active venues"}...\n`);

  const results = await ingestAll({ onlySlug });

  const totalOcc = results.reduce((n, r) => n + r.occurrences, 0);
  console.log(`\nDone. ${totalOcc} occurrence(s) across ${results.length} venue(s).`);
  for (const r of results) {
    if (r.skipped) console.log(`  · ${r.venue}: skipped (${r.skipped})`);
  }
}

main().then(() => process.exit(0));
