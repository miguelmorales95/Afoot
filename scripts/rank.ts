// Nightly traffic scores (lib/rankRun.ts → lib/rank.ts), no AI. Runs after the ingest in
// .github/workflows/ingest.yml. The somedude desk also scores what it adds, right away.
//   npm run rank            npm run rank -- --dry (print the top and bottom, save nothing)
import "./env";
import { rankEvents } from "../lib/rankRun";

rankEvents({ dry: process.argv.includes("--dry") }).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
