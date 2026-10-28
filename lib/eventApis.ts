// Official event APIs: Ticketmaster's Discovery API (free key, TICKETMASTER_API_KEY) and
// Eventbrite's API (a private token, EVENTBRITE_TOKEN). Both return events with their venue,
// which become ordinary Afoot events linked back to the ticket page. Without a key, nothing here
// runs, and links fall back to reading the page itself.
import type { EventCategory } from "./types";

export interface LinkedEvent {
  title: string;
  description: string | null;
  starts_at: string;          // ISO with offset
  ends_at: string | null;
  url: string;
  price: string | null;
  category: EventCategory;
  venue_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

const clip = (s: string | null | undefined, n = 1200) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : null);

// ---- Ticketmaster ------------------------------------------------------------------------
const TM = "https://app.ticketmaster.com/discovery/v2";

function tmCategory(e: any): EventCategory {
  const c = e.classifications?.[0];
  const words = `${c?.segment?.name ?? ""} ${c?.genre?.name ?? ""} ${c?.subGenre?.name ?? ""}`.toLowerCase();
  if (/comedy/.test(words)) return "comedy";
  if (/music/.test(words)) return "music";
  if (/food|drink/.test(words)) return "food";
  return "other";
}

function tmEvent(e: any): LinkedEvent | null {
  const start = e.dates?.start?.dateTime;
  if (!start) return null;
  const v = e._embedded?.venues?.[0];
  const range = e.priceRanges?.[0];
  return {
    title: e.name, description: clip(e.info || e.pleaseNote || e.description), starts_at: start,
    ends_at: e.dates?.end?.dateTime ?? null, url: e.url, category: tmCategory(e),
    price: range ? (range.min === range.max ? `$${Math.round(range.min)}` : `$${Math.round(range.min)}–${Math.round(range.max)}`) : null,
    venue_name: v?.name ?? null,
    address: v ? [v.address?.line1, v.city?.name, v.state?.stateCode].filter(Boolean).join(", ") : null,
    lat: v?.location ? Number(v.location.latitude) : null, lng: v?.location ? Number(v.location.longitude) : null,
  };
}

async function tm(path: string, params: Record<string, string>) {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) throw new Error("TICKETMASTER_API_KEY is not set");
  const res = await fetch(`${TM}${path}?${new URLSearchParams({ ...params, apikey: key })}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Ticketmaster ${res.status}`);
  return res.json();
}

/** Upcoming events at one Ticketmaster venue (its Discovery id, e.g. "KovZpZA7AAEA"). */
export async function ticketmasterVenueEvents(venueId: string): Promise<LinkedEvent[]> {
  const data = await tm("/events.json", { venueId, size: "100", sort: "date,asc" });
  return (data._embedded?.events ?? []).map(tmEvent).filter(Boolean) as LinkedEvent[];
}

/** Ticketmaster venues matching a name near LA, to find the id for a feed. */
export async function ticketmasterVenues(keyword: string) {
  const data = await tm("/venues.json", { keyword, stateCode: "CA", countryCode: "US", size: "20" });
  return (data._embedded?.venues ?? []).map((v: any) => ({
    id: v.id as string, name: v.name as string, city: v.city?.name as string, address: v.address?.line1 as string, upcoming: v.upcomingEvents?._total ?? null,
  }));
}

/** One event from a ticketmaster.com link, when the link carries a Discovery id. */
export async function ticketmasterEventFromUrl(url: string): Promise<LinkedEvent | null> {
  if (!process.env.TICKETMASTER_API_KEY) return null;
  const id = /\/event\/([A-Za-z0-9]{8,})/.exec(url)?.[1];
  if (!id) return null;
  // Links show Ticketmaster's own event id; the Discovery API finds it by that id or its URL.
  for (const params of [{ id }, { keyword: id }] as Record<string, string>[]) {
    const data = await tm("/events.json", { ...params, size: "1" }).catch(() => null);
    const e = data?._embedded?.events?.[0];
    if (e) return tmEvent(e);
  }
  return null;
}

// ---- Eventbrite --------------------------------------------------------------------------
const EB = "https://www.eventbriteapi.com/v3";

async function eb(path: string, params: Record<string, string> = {}) {
  const token = process.env.EVENTBRITE_TOKEN;
  if (!token) throw new Error("EVENTBRITE_TOKEN is not set");
  const res = await fetch(`${EB}${path}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Eventbrite ${res.status}`);
  return res.json();
}

const EB_CATEGORY: Record<string, EventCategory> = { "103": "music", "110": "food", "105": "other", "113": "other", "115": "class", "119": "games" };

function ebEvent(e: any): LinkedEvent | null {
  const start = e.start?.utc;
  if (!start || e.online_event) return null;
  const v = e.venue;
  return {
    title: e.name?.text ?? "Event", description: clip(e.summary || e.description?.text), starts_at: start, ends_at: e.end?.utc ?? null,
    url: e.url, category: EB_CATEGORY[e.category_id] ?? "other",
    price: e.is_free ? "Free" : e.ticket_availability?.minimum_ticket_price?.display ?? null,
    venue_name: v?.name ?? null, address: v?.address?.localized_address_display ?? null,
    lat: v?.latitude ? Number(v.latitude) : null, lng: v?.longitude ? Number(v.longitude) : null,
  };
}

/** Upcoming public events from one Eventbrite organizer (the number in eventbrite.com/o/name-123). */
export async function eventbriteOrganizerEvents(organizerId: string): Promise<LinkedEvent[]> {
  const data = await eb(`/organizers/${organizerId}/events/`, { status: "live", order_by: "start_asc", expand: "venue,ticket_availability", page_size: "100" });
  return (data.events ?? []).map(ebEvent).filter(Boolean) as LinkedEvent[];
}

/** One event from an eventbrite.com/e/...-123456 link. */
export async function eventbriteEventFromUrl(url: string): Promise<LinkedEvent | null> {
  if (!process.env.EVENTBRITE_TOKEN) return null;
  const id = /eventbrite\.[a-z.]+\/e\/(?:[^/?#]*-)?(\d{6,})/.exec(url)?.[1];
  if (!id) return null;
  return ebEvent(await eb(`/events/${id}/`, { expand: "venue,ticket_availability" }));
}

/** The organizer id in an Eventbrite organizer link, or the bare id. */
export const eventbriteOrganizerId = (s: string) => /\/o\/(?:[^/?#]*-)?(\d{6,})/.exec(s)?.[1] ?? (/^\d{6,}$/.test(s.trim()) ? s.trim() : null);
