import { NextRequest, NextResponse } from "next/server";
import { adminAuthed } from "@/lib/adminAuth";
import { supabase } from "@/lib/supabase";
import { eventbriteOrganizerId } from "@/lib/eventApis";
import { venueFor } from "@/lib/venueMatch";
import { CALENDAR_KINDS } from "@/lib/feeds";

// Event feeds (Eventbrite organizers, Ticketmaster venues, iCal, Localist, CivicPlus and Communico calendars), pulled
// daily by `npm run feeds`.
//   GET                              -> { feeds, keys: { ticketmaster, eventbrite } }
//   POST { kind, ref, label?, venue?, address? } -> adds one (an Eventbrite organizer link or id; a
//        Ticketmaster venue id; a calendar's URL, with the venue its unplaced events belong to)
//   PATCH { id, active }             -> pause or resume
//   DELETE ?id=                      -> remove (events already imported stay)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("event_feeds").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feeds: data, keys: { ticketmaster: !!process.env.TICKETMASTER_API_KEY, eventbrite: !!process.env.EVENTBRITE_TOKEN } });
}

export async function POST(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const raw = String(b.ref ?? "").trim();
  const calendar = CALENDAR_KINDS.has(b.kind);
  const ref = b.kind === "eventbrite_organizer" ? eventbriteOrganizerId(raw)
    : b.kind === "ticketmaster_venue" && /^[A-Za-z0-9]{6,24}$/.test(raw) ? raw
    : calendar && /^(https?|webcal):\/\/\S+$/i.test(raw) ? raw : null;
  const label = String(b.label ?? "").trim().slice(0, 120) || null;
  if (!ref) {
    const help = b.kind === "eventbrite_organizer" ? "Paste the organizer's Eventbrite page (eventbrite.com/o/...)"
      : b.kind === "ticketmaster_venue" ? "Paste the venue's Ticketmaster id (npm run ticketmaster:venues finds it)"
      : "Paste the calendar's feed URL (https://…)";
    return NextResponse.json({ error: help }, { status: 400 });
  }
  // Calendar events without their own map pin are listed at this venue (found by name, or made).
  let venue_id: string | null = null;
  if (calendar) {
    const name = String(b.venue ?? "").trim() || label;
    if (!name) return NextResponse.json({ error: "Name the place its events are at (e.g. the campus or library)." }, { status: 400 });
    venue_id = await venueFor({ name, address: String(b.address ?? "").trim() || null, lat: null, lng: null, source: "feed" });
  }
  const { data, error } = await supabase.from("event_feeds").upsert({ kind: b.kind, ref, label, active: true, ...(calendar ? { venue_id } : {}) }, { onConflict: "kind,ref" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feed: data });
}

export async function PATCH(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const { error } = await supabase.from("event_feeds").update({ active: !!b.active }).eq("id", b.id);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  const { error } = await supabase.from("event_feeds").delete().eq("id", id);
  return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
}
