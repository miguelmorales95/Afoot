// Pulls events from every active feed (Eventbrite organizers, Ticketmaster venues).
//   npm run feeds
import "./env";
import { runFeeds } from "../lib/feeds";

runFeeds().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
