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
  // Attendance (going count) is intentionally NOT exposed to clients — it's
  // used only server-side for ranking and to gate the event chat.
  /** How sure we are, and which details still need confirming ("Time unconfirmed"). */
  confidence?: "high" | "medium" | "low";
  uncertain_fields?: UncertainField[];
  cancelled?: boolean;
  /** Tips from people who went, counted per device: { parking: 3, great_vibe: 5 }. */
  heads_up?: Partial<Record<HeadsUpReason, number>>;
}

export type UncertainField = "starts_at" | "date" | "address" | "price";

export const REPORT_REASONS = {
  wrong_info: "Wrong time or place",
  cancelled: "Cancelled / not happening",
  scam: "Scam or spam",
  not_real: "Not a real event",
  duplicate: "Duplicate listing",
  inappropriate: "Inappropriate",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const HEADS_UP_REASONS = {
  great_vibe: "Great vibe",
  parking: "Hard to park",
  crowded: "Too crowded",
  not_as_described: "Not as described",
  not_accessible: "Not accessible",
  unsafe: "Felt unsafe",
} as const;
export type HeadsUpReason = keyof typeof HEADS_UP_REASONS;

export interface ChatMessage {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
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

/** An event in the /admin flag queue. */
export interface FlaggedEvent {
  event_id: string;
  title: string;
  venue: string | null;
  status: string;
  confidence: string | null;
  uncertain_fields: string[];
  research_notes: string | null;
  url: string | null;
  source_url: string | null;
  reasons: Record<string, number>; // "report:scam" -> distinct devices
  notes: string[];
  last_at: string;
}
