// Ingest pipeline CLI.
//   npm run ingest                                   # all active venues
//   npm run ingest -- smog-city-torrance             # just one (by slug)
//   npm run ingest -- --dry-run [slug]               # extract and print, write nothing
//   npm run ingest -- --url <events page> --name "Venue"   # preview any page (implies --dry-run;
//                                                    # needs no database row)
// The model comes from LLM_PROVIDER: "ollama" is free and local; "anthropic" costs money.

import "./env";

import { ingestAll, ingestVenue } from "../lib/ingest";
import type { Venue } from "../lib/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const url = arg("url");
  const name = arg("name");
  const dryRun = args.includes("--dry-run") || !!url;
  const valueOf = new Set([url, name].filter(Boolean));
  const onlySlug = args.find((a) => !a.startsWith("--") && !valueOf.has(a));
  console.log(`LLM provider: ${process.env.LLM_PROVIDER || "anthropic"}${dryRun ? " — dry run, nothing is written" : ""}`);

  if (url) {
    const venue = { id: "preview", name: name || new URL(url).hostname, slug: "preview", website: url, events_url: url } as Venue;
    await ingestVenue(venue, console.log, { dryRun: true });
    return;
  }

  console.log(`Ingesting${onlySlug ? ` "${onlySlug}"` : " all active venues"}...\n`);
  const results = await ingestAll({ onlySlug, dryRun });

  const totalOcc = results.reduce((n, r) => n + r.occurrences, 0);
  console.log(`\nDone. ${totalOcc} occurrence(s) across ${results.length} venue(s)${dryRun ? " (dry run: not saved)" : ""}.`);
  for (const r of results) {
    if (r.skipped) console.log(`  · ${r.venue}: skipped (${r.skipped})`);
  }
  // Every venue erroring means something is wrong for all of them (a bad AI key, the database):
  // fail the run so GitHub Actions marks it red and emails, instead of quietly importing nothing.
  if (results.length > 1 && results.every((r) => r.skipped === "error")) {
    console.error("\nEvery venue failed: check the errors above (often ANTHROPIC_API_KEY).");
    process.exitCode = 1;
  }
}

main().then(() => process.exit(process.exitCode ?? 0));
