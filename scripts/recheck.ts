// AI clean-up of uncertain events (see lib/recheck.ts).
//   npm run recheck                 # re-check up to 40 events that are due
//   npm run recheck -- --dry-run    # show what it would do, change nothing
//   npm run recheck -- --limit 5
// Pick the model with LLM_PROVIDER: "ollama" (free, local) or "anthropic" (Haiku 5.5).

import "./env";

import { recheckEvents } from "../lib/recheck";

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const results = await recheckEvents({
    dryRun: args.includes("--dry-run"),
    limit: limitArg >= 0 ? Number(args[limitArg + 1]) : undefined,
  });
  const confirmed = results.filter((r) => /(^|; )confirmed /.test(r.outcome)).length;
  const flagged = results.filter((r) => /differs|cancelled/.test(r.outcome)).length;
  console.log(`\nDone: ${results.length} checked, ${confirmed} with details confirmed, ${flagged} sent to /admin.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
