// Event feeds, pulled every day by `npm run feeds` (the GitHub Actions job, after ingest):
//   eventbrite_organizer, ticketmaster_venue  official APIs; each event goes to its own venue
//     (matched by name or location, or created), linked to its ticket page. Skipped without a key.
//   ics, localist, civicplus, communico  official public calendars (colleges, libraries, parks, museums, malls; see
//     lib/calendarFeeds.ts). Events with a map pin go to that place; the rest to the feed's venue.
import { supabase } from "./supabase";
import { storeExtractedEvents } from "./ingest";
import { venueFor } from "./venueMatch";
import { eventbriteOrganizerEvents, ticketmasterVenueEvents, type LinkedEvent } from "./eventApis";
import { icsEvents, localistEvents, civicplusEvents, communicoEvents, type FeedOptions } from "./calendarFeeds";

interface FeedRow { id: string; kind: string; ref: string; label: string | null; venue_id: string | null; options: FeedOptions | null }

const SOURCE: Record<string, "ticketmaster" | "eventbrite" | "feed"> = {
  ticketmaster_venue: "ticketmaster", eventbrite_organizer: "eventbrite", ics: "feed", localist: "feed", civicplus: "feed", communico: "feed",
};

/** Official calendars (as opposed to ticketing APIs). */
export const CALENDAR_KINDS = new Set(["ics", "localist", "civicplus", "communico"]);

export async function eventsOf(f: Pick<FeedRow, "kind" | "ref" | "options">): Promise<LinkedEvent[] | string> {
  if (f.kind === "ticketmaster_venue") return process.env.TICKETMASTER_API_KEY ? ticketmasterVenueEvents(f.ref) : "skipped (no TICKETMASTER_API_KEY)";
  if (f.kind === "eventbrite_organizer") return process.env.EVENTBRITE_TOKEN ? eventbriteOrganizerEvents(f.ref) : "skipped (no EVENTBRITE_TOKEN)";
  if (f.kind === "ics") return icsEvents(f.ref, f.options ?? {});
  if (f.kind === "localist") return localistEvents(f.ref, f.options ?? {});
  if (f.kind === "civicplus") return civicplusEvents(f.ref, f.options ?? {});
  if (f.kind === "communico") return communicoEvents(f.ref, f.options ?? {});
  return `skipped (unknown kind ${f.kind})`;
}

/** The venue for one feed event: its own place when it has a pin (or the feed has no venue), else the feed's. */
async function venueOf(f: FeedRow, e: LinkedEvent): Promise<string | null> {
  if (!CALENDAR_KINDS.has(f.kind)) return venueFor({ name: e.venue_name, address: e.address, lat: e.lat, lng: e.lng, source: SOURCE[f.kind] });
  if (e.venue_name && e.lat != null && e.lng != null) {
    // "Royce Hall, UCLA": room and hall names repeat across campuses, so they carry the feed's name.
    const name = f.label && !e.venue_name.toLowerCase().includes(f.label.toLowerCase()) ? `${e.venue_name}, ${f.label}` : e.venue_name;
    return venueFor({ name: name.slice(0, 120), address: e.address, lat: e.lat, lng: e.lng, source: "feed" });
  }
  return f.venue_id;
}

export async function runFeeds(log: (s: string) => void = console.log, only?: string) {
  let q = supabase.from("event_feeds").select("*").eq("active", true).order("created_at");
  if (only) q = q.or(`label.ilike.%${only.replace(/[%,()]/g, " ")}%,ref.eq.${only.replace(/[,()]/g, "")}`);
  const { data: feeds, error } = await q;
  if (error) throw error;
  // Calendars that share items (the Valley's neighborhood councils publish one regional calendar)
  // list each one once: the first feed to carry it keeps it.
  const seen = new Set<string>();
  for (const f of (feeds ?? []) as FeedRow[]) {
    let result: string;
    try {
      const all = await eventsOf(f);
      if (typeof all === "string") { log(`- ${f.label ?? f.ref}: ${all}`); continue; }
      const events = CALENDAR_KINDS.has(f.kind) ? all.filter((e) => {
        const key = `${e.title.toLowerCase()}|${e.starts_at.slice(0, 16)}`;
        return seen.has(key) ? false : (seen.add(key), true);
      }) : all;
      // Group by venue, then by title: the same title on several dates is one event with several dates.
      const byVenue = new Map<string, LinkedEvent[]>();
      let placeless = 0;
      for (const e of events) {
        const venueId = await venueOf(f, e);
        if (!venueId) { placeless++; continue; }
        // Events filed under the feed's own venue keep their room or building in the description.
        const where = venueId === f.venue_id && e.venue_name ? `Where: ${e.venue_name}\n` : "";
        byVenue.set(venueId, [...(byVenue.get(venueId) ?? []), { ...e, description: `${where}${e.description ?? ""}`.trim() || null }]);
      }
      let n = 0;
      for (const [venueId, list] of byVenue) {
        const byTitle = new Map<string, LinkedEvent[]>();
        for (const e of list) byTitle.set(e.title, [...(byTitle.get(e.title) ?? []), e]);
        // Something on more than 20 days in a calendar is opening hours or a standing exhibit, not an outing.
        if (CALENDAR_KINDS.has(f.kind)) {
          for (const [title, same] of byTitle) if (new Set(same.map((e) => e.starts_at.slice(0, 10))).size > 20) byTitle.delete(title);
        }
        n += await storeExtractedEvents({
          venueId, source: SOURCE[f.kind] ?? "feed",
          events: [...byTitle.values()].map((same) => ({
            title: same[0].title, description: same[0].description, category: same[0].category, price: same[0].price, url: same[0].url,
            recurrence_description: null, is_recurring: same.length > 1, tags: [],
            occurrences: same.map((e) => ({ start: new Date(e.starts_at).toISOString(), end: e.ends_at ? new Date(e.ends_at).toISOString() : null })),
          })),
        });
      }
      result = `${events.length} event(s), ${n} occurrence(s), ${byVenue.size} venue(s)${placeless ? `, ${placeless} without a place (set the feed's venue)` : ""}`;
    } catch (e) {
      result = `error: ${(e as Error).message}`;
    }
    log(`- ${f.label ?? f.ref}: ${result}`);
    await supabase.from("event_feeds").update({ last_run_at: new Date().toISOString(), last_result: result }).eq("id", f.id);
  }
}
