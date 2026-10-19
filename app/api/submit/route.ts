import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/submit  — community venue submissions (no login).
// Body: { venue_name, website, events_url?, city?, note?, submitter_email?, company? }
// `company` is a honeypot: real users never fill it.

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Honeypot — silently accept so bots don't learn, but store nothing.
  if (body.company) return NextResponse.json({ ok: true });

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
