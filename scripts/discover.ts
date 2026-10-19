// Web discovery crawler CLI. Finds likely LA venues and stores them as
// candidate_venues for review/promotion.
//
//   npm run discover                 # one pass (default limits)
//   npm run discover -- --loop       # keep running, pass after pass
//   npm run discover -- --queries 40 --max 60 --min 0.6
//
// Tip: set LLM_PROVIDER=ollama in .env.local to classify for free with a local
// model and leave this running for hours.

import { config } from "dotenv";
config({ path: ".env.local" });

import { discover } from "../lib/discover";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const loop = process.argv.includes("--loop");
  const queryLimit = parseInt(arg("queries", "25")!, 10);
  const maxCandidates = parseInt(arg("max", "40")!, 10);
  const minConfidence = parseFloat(arg("min", "0.5")!);

  let pass = 0;
  do {
    pass++;
    console.log(`\n===== Discovery pass ${pass} =====`);
    const summary = await discover({ queryLimit, maxCandidates, minConfidence });
    console.log(
      `\nPass ${pass} done: fetched ${summary.sitesFetched} sites, stored ${summary.stored} new candidates (via ${summary.backend}).`,
    );
    console.log(`Review them:  select venue_name, score, neighborhood, events_url from candidate_venues where status='new' order by score desc;`);
    if (loop) {
      console.log("Sleeping 60s before next pass (Ctrl+C to stop)...");
      await new Promise((r) => setTimeout(r, 60000));
    }
  } while (loop);
}

main().then(() => process.exit(0));
