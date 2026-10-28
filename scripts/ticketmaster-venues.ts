// Finds a venue's Ticketmaster id, to add it as a feed in /admin.
//   npm run ticketmaster:venues -- "Lodge Room"
import "./env";
import { ticketmasterVenues } from "../lib/eventApis";

const q = process.argv.slice(2).join(" ");
if (!q) { console.error('Usage: npm run ticketmaster:venues -- "<venue name>"'); process.exit(1); }
ticketmasterVenues(q).then((vs) => {
  for (const v of vs) console.log(`${v.id}  ${v.name} — ${v.address ?? ""}, ${v.city ?? ""}${v.upcoming != null ? ` (${v.upcoming} upcoming)` : ""}`);
  if (!vs.length) console.log("No matches in California.");
}, (e) => { console.error(e.message); process.exit(1); });
