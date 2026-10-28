import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { submitEventLink } from "@/lib/eventLinks";
import { laLocalToIso } from "@/lib/eventLink";

// POST /api/submit  — community submissions (no login), checked by an admin before anything shows.
// A venue: { venue_name, website, events_url?, city?, note?, submitter_email?, company? }
// An event: { kind: "event", event_url, title?, starts?, place?, address?, note?, submitter_email? }
//   (a Facebook, Eventbrite, Ticketmaster or any event page; `starts` is "YYYY-MM-DDTHH:mm" in LA).
// `company` is a honeypot: real users never fill it.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Honeypot — silently accept so bots don't learn, but store nothing.
  if (body.company) return NextResponse.json({ ok: true });

  if (body.kind === "event") {
    const url = (body.event_url || "").trim();
    if (!/^https?:\/\/.+\..+/.test(url)) return NextResponse.json({ error: "Paste the event's link." }, { status: 400 });
    const clean = (s?: string, n = 200) => (s || "").trim().slice(0, n) || null;
    try {
      const r = await submitEventLink(url, {
        title: clean(body.title) ?? undefined, starts_at: (body.starts && laLocalToIso(body.starts)) || undefined,
        venue_name: clean(body.place) ?? undefined, address: clean(body.address, 300) ?? undefined,
      }, { note: clean(body.note, 1000), email: clean(body.submitter_email) });
      return NextResponse.json({ ok: true, ...r });
    } catch (err) {
      console.error("event link error:", (err as Error).message);
      return NextResponse.json({ error: "could not save the event" }, { status: 500 });
    }
  }

  const website = (body.website || "").trim();
  if (!website || !/^https?:\/\/.+\..+/.test(website)) {
    return NextResponse.json(
      { error: "A valid website URL is required." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("submissions").insert({
    venue_name: (body.venue_name || "").trim() || null,
    website,
    events_url: (body.events_url || "").trim() || null,
    city: (body.city || "").trim() || null,
    note: (body.note || "").trim().slice(0, 1000) || null,
    submitter_email: (body.submitter_email || "").trim() || null,
    status: "pending",
  });

  if (error) {
    console.error("submission error:", error.message);
    return NextResponse.json({ error: "could not save submission" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
