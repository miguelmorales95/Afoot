// Event feeds: Eventbrite organizers and Ticketmaster venues whose upcoming events come in every
// day through the official APIs (npm run feeds, run by the GitHub Actions job after ingest).
// Each event goes to its own venue (matched by name or location, or created), linked to its
// ticket page. A feed whose key isn't set is skipped.
import { supabase } from "./supabase";
import { storeExtractedEvents } from "./ingest";
import { venueFor } from "./venueMatch";
import { eventbriteOrganizerEvents, ticketmasterVenueEvents, type LinkedEvent } from "./eventApis";

export async function runFeeds(log: (s: string) => void = console.log) {
  const { data: feeds, error } = await supabase.from("event_feeds").select("*").eq("active", true);
  if (error) throw error;
  for (const f of feeds ?? []) {
    let result: string;
    try {
      const keyed = f.kind === "ticketmaster_venue" ? process.env.TICKETMASTER_API_KEY : process.env.EVENTBRITE_TOKEN;
      if (!keyed) { log(`- ${f.label ?? f.ref}: skipped (no ${f.kind === "ticketmaster_venue" ? "TICKETMASTER_API_KEY" : "EVENTBRITE_TOKEN"})`); continue; }
      const events: LinkedEvent[] = f.kind === "ticketmaster_venue" ? await ticketmasterVenueEvents(f.ref) : await eventbriteOrganizerEvents(f.ref);
      // Group by venue so each venue's events are stored together.
      const byVenue = new Map<string, LinkedEvent[]>();
      for (const e of events) {
        const key = `${e.venue_name}|${e.address}`;
        byVenue.set(key, [...(byVenue.get(key) ?? []), e]);
      }
      let n = 0;
      for (const list of byVenue.values()) {
        const v = list[0];
        const venueId = await venueFor({ name: v.venue_name, address: v.address, lat: v.lat, lng: v.lng, source: f.kind === "ticketmaster_venue" ? "ticketmaster" : "eventbrite" });
        // Same title on several dates becomes one event with several occurrences.
        const byTitle = new Map<string, LinkedEvent[]>();
        for (const e of list) byTitle.set(e.title, [...(byTitle.get(e.title) ?? []), e]);
        n += await storeExtractedEvents({
          venueId, source: f.kind === "ticketmaster_venue" ? "ticketmaster" : "eventbrite",
          events: [...byTitle.values()].map((same) => ({
            title: same[0].title, description: same[0].description, category: same[0].category, price: same[0].price, url: same[0].url,
            recurrence_description: null, is_recurring: same.length > 1, tags: [],
            occurrences: same.map((e) => ({ start: new Date(e.starts_at).toISOString(), end: e.ends_at ? new Date(e.ends_at).toISOString() : null })),
          })),
        });
      }
      result = `${events.length} event(s), ${n} occurrence(s)`;
    } catch (e) {
      result = `error: ${(e as Error).message}`;
    }
    log(`- ${f.label ?? f.ref}: ${result}`);
    await supabase.from("event_feeds").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", f.id);
  }
}
