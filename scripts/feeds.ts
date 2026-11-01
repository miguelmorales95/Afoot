// Pulls events from every active feed (Eventbrite organizers, Ticketmaster venues, iCal and
// Localist calendars).
//   npm run feeds                                   # every active feed
//   npm run feeds -- "UCLA"                         # feeds whose label contains UCLA
//   npm run feeds -- --dry-run ics <url>            # print what a feed holds; writes nothing
//   npm run feeds -- --dry-run localist https://calendar.example.edu
import "./env";
import { eventsOf, runFeeds } from "../lib/feeds";

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--dry-run") {
    const [, kind, ref] = args;
    const events = await eventsOf({ kind, ref, options: null });
    if (typeof events === "string") return console.log(events);
    for (const e of events) {
      const when = new Date(e.starts_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
      console.log(`${when.padEnd(24)} ${e.category.padEnd(7)} ${e.title.slice(0, 70)}${e.venue_name ? ` @ ${e.venue_name}` : ""}${e.lat != null ? " 📍" : ""}`);
    }
    return console.log(`\n${events.length} upcoming event(s) after filtering.`);
  }
  await runFeeds(console.log, args[0]);
}

main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
