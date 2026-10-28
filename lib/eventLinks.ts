// The event-link queue: links pasted on /submit wait here until an admin approves them (with
// any fixes) into events, or rejects them.
import { supabase } from "./supabase";
import { storeExtractedEvents } from "./ingest";
import { venueFor } from "./venueMatch";
import { readEventLink, type LinkDetails } from "./eventLink";
import type { EventCategory } from "./types";

export interface EventLinkRow {
  id: string; url: string; source: string; status: string; extracted: LinkDetails | null;
  read_error: string | null; note: string | null; submitter_email: string | null; created_at: string;
}

/** Saves a pasted link with what could be read from it; the submitter's own details fill gaps. */
export async function submitEventLink(url: string, typed: LinkDetails, extra: { note: string | null; email: string | null }) {
  const { data: dup } = await supabase.from("event_links").select("id").eq("url", url).eq("status", "pending").maybeSingle();
  if (dup) return { duplicate: true };
  const read = await readEventLink(url);
  const merged: LinkDetails = { ...(read.details ?? {}) };
  for (const [k, v] of Object.entries(typed)) if (v != null && v !== "" && (merged as any)[k] == null) (merged as any)[k] = v;
  // What the submitter typed wins over a guess for the basics, if the page had none.
  const { error } = await supabase.from("event_links").insert({
    url, source: read.source, extracted: merged, read_error: read.error, note: extra.note, submitter_email: extra.email,
  });
  if (error) throw new Error(error.message);
  return { duplicate: false, readable: !read.error, source: read.source };
}

export async function pendingEventLinks(): Promise<EventLinkRow[]> {
  const { data, error } = await supabase.from("event_links").select("*").eq("status", "pending").order("created_at").limit(200);
  if (error) throw new Error(error.message);
  return data as EventLinkRow[];
}

const CATS: EventCategory[] = ["music", "karaoke", "trivia", "games", "comedy", "market", "food", "class", "other"];

/** Approves a link (with the admin's corrections) into a live event at a matched or new venue. */
export async function approveEventLink(id: string, d: LinkDetails) {
  const { data: link } = await supabase.from("event_links").select("*").eq("id", id).single();
  if (!link) throw new Error("not found");
  if (!d.title?.trim() || !d.starts_at || Number.isNaN(Date.parse(d.starts_at))) throw new Error("A title and a start time are needed");
  const venueId = await venueFor({ name: d.venue_name ?? null, address: d.address ?? null, lat: d.lat ?? null, lng: d.lng ?? null, source: "link" });
  const source = link.source === "eventbrite" || link.source === "ticketmaster" ? link.source : "link";
  await storeExtractedEvents({
    venueId, source, fallbackUrl: link.url,
    events: [{
      title: d.title.trim(), description: d.description ?? null, category: CATS.includes(d.category as EventCategory) ? d.category as EventCategory : "other",
      price: d.price ?? null, url: d.url || link.url, recurrence_description: null, is_recurring: false, tags: [],
      occurrences: [{ start: new Date(d.starts_at).toISOString(), end: d.ends_at && !Number.isNaN(Date.parse(d.ends_at)) ? new Date(d.ends_at).toISOString() : null }],
    }],
  });
  const { data: ev } = await supabase.from("events").select("id").eq("venue_id", venueId).eq("title", d.title.trim()).maybeSingle();
  await supabase.from("event_links").update({ status: "approved", extracted: d, event_id: ev?.id ?? null }).eq("id", id);
  return { venueId, eventId: ev?.id ?? null };
}

export async function rejectEventLink(id: string) {
  await supabase.from("event_links").update({ status: "rejected" }).eq("id", id);
}
