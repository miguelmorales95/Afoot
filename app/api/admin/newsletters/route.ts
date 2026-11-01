import { NextRequest, NextResponse } from "next/server";
import { adminAuthed } from "@/lib/adminAuth";
import { supabase, hasSupabase } from "@/lib/supabase";
import { isUuid } from "@/lib/campaigns";
import { learnSender } from "@/lib/newsletter";

// Newsletters for /admin (ADMIN_TOKEN). Emails reach the inbox address, the webhook saves them, and
// the daily job reads their events.
//   GET                     -> { inbox, emails (recent, not yet handled first), sources, waiting }
//   GET ?venueSearch=lyric  -> { venues: [{ id, name }] }
//   POST { kind: "assign",  id, venueId }  this sender is that venue: remember it, read the email next run
//   POST { kind: "done",    id }           confirmation clicked, or not a newsletter: stop showing it
//   POST { kind: "signup",  venueId, url } a venue's newsletter signup page
export const dynamic = "force-dynamic";

const INBOX = process.env.NEWSLETTER_INBOX || "afoot-news@somedude.app";

export async function GET(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSupabase) return NextResponse.json({ inbox: INBOX, emails: [], sources: [], waiting: [] });

  const q = req.nextUrl.searchParams.get("venueSearch");
  if (q !== null) {
    const { data } = await supabase.from("venues").select("id, name, city")
      .ilike("name", `%${q.replace(/[%_,()]/g, " ").trim().slice(0, 60)}%`).order("name").limit(10);
    return NextResponse.json({ venues: data ?? [] });
  }

  const [em, src, ven] = await Promise.all([
    supabase.from("inbound_emails")
      .select("id, from_address, from_name, subject, received_at, status, events_found, note, venues(name)")
      .neq("status", "ignored").order("received_at", { ascending: false }).limit(60),
    supabase.from("newsletter_sources").select("id, from_address, from_domain, match_keyword, venue_id, venues(name)").order("created_at", { ascending: false }),
    supabase.from("venues").select("id, name, newsletter_url, active").not("newsletter_url", "is", null).order("name"),
  ]);
  if (em.error) return NextResponse.json({ error: `Newsletter tables unavailable (${em.error.message}).` }, { status: 500 });

  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { name?: string } | null;
  const mapped = new Set((src.data ?? []).map((s) => s.venue_id));
  // Waiting: a signup page is known but no newsletter has arrived from that venue yet.
  const waiting = (ven.data ?? []).filter((v) => !mapped.has(v.id));
  const order: Record<string, number> = { needs_confirm: 0, unmatched: 1, error: 2, queued: 3, processed: 4 };
  const emails = (em.data ?? [])
    .map(({ venues, ...e }) => ({ ...e, venue: one(venues)?.name ?? null }))
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const sources = (src.data ?? []).map(({ venues, ...s }) => ({ ...s, venue: one(venues)?.name ?? null }));
  return NextResponse.json({ inbox: INBOX, emails, sources, waiting });
}

export async function POST(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSupabase) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  if (body?.kind === "assign") {
    if (!isUuid(body.id) || !isUuid(body.venueId)) return bad("Pick a venue.");
    const [{ data: email }, { data: venue }] = await Promise.all([
      supabase.from("inbound_emails").select("from_address").eq("id", body.id).maybeSingle(),
      supabase.from("venues").select("id, name").eq("id", body.venueId).maybeSingle(),
    ]);
    if (!email || !venue) return bad("That email or venue is gone.");
    if (email.from_address) await learnSender(venue.id, venue.name, email.from_address);
    // Every unhandled email from this sender is read on the next run.
    await supabase.from("inbound_emails").update({ matched_venue_id: venue.id, status: "queued" })
      .eq("from_address", email.from_address ?? "").in("status", ["unmatched", "error", "queued"]);
    return NextResponse.json({ ok: true });
  }

  if (body?.kind === "done") {
    if (!isUuid(body.id)) return bad("invalid id");
    await supabase.from("inbound_emails").update({ status: "ignored" }).eq("id", body.id);
    return NextResponse.json({ ok: true });
  }

  if (body?.kind === "signup") {
    if (!isUuid(body.venueId)) return bad("invalid venue");
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (url && !/^https?:\/\/\S+$/i.test(url)) return bad("The signup link must start with https://");
    await supabase.from("venues").update({ newsletter_url: url || null }).eq("id", body.venueId);
    return NextResponse.json({ ok: true });
  }

  return bad("unknown request");
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
