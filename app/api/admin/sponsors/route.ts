import { NextRequest, NextResponse } from "next/server";
import { adminAuthed } from "@/lib/adminAuth";
import { supabase, hasSupabase } from "@/lib/supabase";
import { CAMPAIGN_STATUSES, type CampaignStatus } from "@/lib/ads";
import { CAMPAIGN_COLUMNS, isUuid, todayLA, type CampaignRow } from "@/lib/campaigns";
import { LAUNCH_AREAS } from "@/lib/areas";

// Sponsors and campaigns for /admin. Protected by ADMIN_TOKEN like the review queue.
//   GET                      -> { ready, sponsors, campaigns (with counts) }
//   GET ?eventSearch=trivia  -> { events: [{ id, title, venue }] } (to pick a featured event)
//   POST { kind: "sponsor",  sponsor }   create (no id) or update
//   POST { kind: "campaign", campaign }  create (no id) or update
//   POST { kind: "status",   id, status }
export const dynamic = "force-dynamic";


const AREAS = ["all", ...LAUNCH_AREAS.map((a) => a.name)];
const MIGRATION = "supabase/migrations/20261023120000_sponsor_campaigns.sql";

interface Counts { views: number; clicks: number; views30: number; clicks30: number }

export async function GET(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSupabase) return NextResponse.json({ ready: false, note: "No database configured." });

  const q = req.nextUrl.searchParams.get("eventSearch");
  if (q !== null) {
    const { data } = await supabase
      .from("events")
      .select("id, title, venues(name)")
      .eq("status", "active")
      .ilike("title", `%${q.replace(/[%_,()]/g, " ").trim().slice(0, 60)}%`)
      .limit(10);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (data || []).map((e: any) => ({ id: e.id, title: e.title, venue: (Array.isArray(e.venues) ? e.venues[0] : e.venues)?.name ?? null }));
    return NextResponse.json({ events });
  }

  const [sp, cp, dp] = await Promise.all([
    supabase.from("sponsors").select("*").order("business_name"),
    supabase.from("campaigns").select(`${CAMPAIGN_COLUMNS}, events(title)`).order("starts_on", { ascending: false }),
    supabase.from("campaign_daily").select("campaign_id, day, views, clicks"),
  ]);
  const err = sp.error || cp.error || dp.error;
  if (err) {
    // Usually: the tables don't exist yet.
    return NextResponse.json({ ready: false, note: `Sponsor tables unavailable (${err.message}). Apply ${MIGRATION}.` });
  }

  // Totals and the last 30 LA days, per campaign.
  const since = todayLA(new Date(Date.now() - 29 * 86_400_000));
  const counts: Record<string, Counts> = {};
  for (const d of dp.data || []) {
    const c = (counts[d.campaign_id] ||= { views: 0, clicks: 0, views30: 0, clicks30: 0 });
    c.views += d.views;
    c.clicks += d.clicks;
    if (d.day >= since) {
      c.views30 += d.views;
      c.clicks30 += d.clicks;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campaigns = (cp.data || []).map(({ events, ...c }: any) => ({
    ...c,
    event_title: (Array.isArray(events) ? events[0] : events)?.title ?? null,
    counts: counts[c.id] ?? { views: 0, clicks: 0, views30: 0, clicks30: 0 },
  }));
  return NextResponse.json({ ready: true, sponsors: sp.data, campaigns, areas: AREAS, today: todayLA() });
}

export async function POST(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSupabase) return NextResponse.json({ error: "No database configured." }, { status: 503 });
  const body = await req.json().catch(() => ({}));

  if (body?.kind === "status") {
    if (!isUuid(body.id) || !CAMPAIGN_STATUSES.includes(body.status)) return bad("invalid status change");
    const { error } = await supabase.from("campaigns")
      .update({ status: body.status as CampaignStatus, updated_at: new Date().toISOString() }).eq("id", body.id);
    return error ? failed(error.message) : NextResponse.json({ ok: true });
  }

  if (body?.kind === "sponsor") {
    const s = body.sponsor ?? {};
    const row = {
      business_name: str(s.business_name, 120),
      contact_name: str(s.contact_name, 120),
      contact_email: str(s.contact_email, 200),
      stripe_customer_id: str(s.stripe_customer_id, 100),
      notes: str(s.notes, 2000),
    };
    if (s.id && !isUuid(s.id)) return bad("invalid sponsor id");
    if (!row.business_name) return bad("Business name is required.");
    if (row.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.contact_email)) return bad("That contact email doesn't look right.");
    if (row.stripe_customer_id && !/^cus_[A-Za-z0-9]+$/.test(row.stripe_customer_id)) return bad("Stripe customer ids look like cus_…");
    const { data, error } = s.id
      ? await supabase.from("sponsors").update(row).eq("id", s.id).select().single()
      : await supabase.from("sponsors").insert(row).select().single();
    return error ? failed(error.message) : NextResponse.json({ ok: true, sponsor: data });
  }

  if (body?.kind === "campaign") {
    const c = body.campaign ?? {};
    const row: Partial<CampaignRow> = {
      sponsor_id: c.sponsor_id,
      product: c.product,
      area: c.area,
      event_id: c.product === "featured_event" ? c.event_id || null : null,
      starts_on: c.starts_on,
      ends_on: c.ends_on,
      badge: str(c.badge, 16),
      title: str(c.title, 60) ?? undefined,
      body: str(c.body, 160),
      cta: str(c.cta, 40),
      href: str(c.href, 1000) ?? undefined,
      status: c.status ?? "draft",
      price_cents: c.price_cents === "" || c.price_cents == null ? null : Math.round(Number(c.price_cents)),
      updated_at: new Date().toISOString(),
    };
    if (c.id && !isUuid(c.id)) return bad("invalid campaign id");
    const problem = checkCampaign(row);
    if (problem) return bad(problem);
    const { data, error } = c.id
      ? await supabase.from("campaigns").update(row).eq("id", c.id).select().single()
      : await supabase.from("campaigns").insert(row).select().single();
    return error ? failed(error.message) : NextResponse.json({ ok: true, campaign: data });
  }

  return bad("unknown request");
}

function checkCampaign(r: Partial<CampaignRow>): string | null {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!isUuid(r.sponsor_id)) return "Pick a sponsor.";
  if (r.product !== "area_sponsor" && r.product !== "featured_event") return "Pick a product.";
  if (!r.area || !AREAS.includes(r.area)) return "Pick an area (or All areas).";
  if (r.product === "featured_event" && !isUuid(r.event_id)) return "A featured event needs the event it features.";
  if (!date.test(r.starts_on ?? "") || !date.test(r.ends_on ?? "")) return "Start and end dates are required.";
  if (r.ends_on! < r.starts_on!) return "The end date is before the start date.";
  if (!r.title) return "The card needs a title.";
  // Only web links (or a page on Afoot); never javascript: or data: URLs.
  if (!r.href || !(/^https?:\/\/[^\s]+$/i.test(r.href) || /^\/(?![/\\])\S*$/.test(r.href))) return "The link must start with https:// (or / for a page on Afoot).";
  if (!CAMPAIGN_STATUSES.includes(r.status as CampaignStatus)) return "Unknown status.";
  if (r.price_cents != null && (!Number.isFinite(r.price_cents) || r.price_cents < 0)) return "Price must be a positive number.";
  return null;
}

/** Trimmed, length-capped text; empty -> null. */
function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

function failed(message: string) {
  console.error("admin sponsors error:", message);
  return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
}
