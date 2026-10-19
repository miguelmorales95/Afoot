// Shared types for the whole app.

export type EventCategory =
  | "music"
  | "karaoke"
  | "trivia"
  | "games"
  | "comedy"
  | "market"
  | "food"
  | "class"
  | "other";

/** One concrete occurrence returned by the `nearby_events` RPC (a flat row). */
export interface NearbyEvent {
  occurrence_id: string;
  event_id: string;
  title: string;
  description: string | null;
  category: EventCategory | null;
  price: string | null;
  url: string | null;
  recurrence_description: string | null;
  is_recurring: boolean;
  tags: string[] | null;
  starts_at: string; // ISO timestamptz
  ends_at: string | null;
  venue_id: string;
  venue_name: string;
  venue_address: string | null;
  venue_lat: number;
  venue_lng: number;
  distance_km: number;
  going_count: number;
}

export interface Attendee {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface IncomingRequest {
  id: string;
  requester_id: string;
  requester_name: string;
  occurrence_id: string | null;
  message: string | null;
  status: "pending" | "approved" | "denied";
  created_at: string;
}

export interface OutgoingRequest {
  id: string;
  recipient_id: string;
  recipient_name: string;
  occurrence_id: string | null;
  status: "pending" | "approved" | "denied";
  shared_phone: string | null;
  created_at: string;
}

/** Shape the extractor (Claude) returns for each event on a venue page. */
export interface ExtractedEvent {
  title: string;
  description: string | null;
  category: EventCategory;
  price: string | null;
  url: string | null;
  /** Human-readable recurrence, e.g. "Every 2nd & 4th Tuesday". Null for one-offs. */
  recurrence_description: string | null;
  is_recurring: boolean;
  /** Short vibe/activity tags, e.g. ["outdoor", "chill", "live band"]. */
  tags: string[];
  /** Concrete upcoming date/times, already expanded from any recurrence. */
  occurrences: { start: string; end: string | null }[];
}

export interface ReviewSource {
  kind: "submission" | "discovery";
  id: string;
  note: string | null;
  score: number | null;
  created_at: string | null;
}

/** A deduped, grouped-by-site review item for the admin page. */
export interface ReviewGroup {
  domain: string;
  name: string;
  website: string | null;
  events_url: string | null;
  newsletter_url: string | null;
  neighborhood: string | null;
  city: string | null;
  sources: ReviewSource[];
  score: number | null; // best discovery confidence, if any
}

export interface Venue {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  events_url: string | null;
  newsletter_url: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  source: string;
  active: boolean;
  render: boolean;
  last_ingested_at: string | null;
}
