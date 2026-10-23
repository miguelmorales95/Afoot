import { NextRequest, NextResponse } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";
import type { FlaggedEvent } from "@/lib/types";

// Flag queue for /admin: events people reported (or that community checks disputed),
// grouped by event. Protected by ADMIN_TOKEN like the review queue.
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // not configured -> open (local only)
  return req.headers.get("x-admin-token") === token;
}


export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasSupabase) return NextResponse.json({ events: [] });

  const { data, error } = await supabase
    .from("event_flags")
    .select("event_id, kind, reason, note, device_hash, created_at, events(title, status, confidence, uncertain_fields, notes, url, source_url, venues(name))")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byEvent = new Map<string, FlaggedEvent & { devices: Record<string, Set<string>> }>();
  for (const f of data || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev: any = Array.isArray(f.events) ? f.events[0] : f.events;
    if (!ev) continue;
    if (!byEvent.has(f.event_id)) {
      byEvent.set(f.event_id, {
        event_id: f.event_id, title: ev.title, venue: ev.venues?.name ?? null, status: ev.status,
        confidence: ev.confidence, uncertain_fields: ev.uncertain_fields || [], research_notes: ev.notes,
        url: ev.url, source_url: ev.source_url, reasons: {}, notes: [], last_at: f.created_at, devices: {},
      });
    }
    const g = byEvent.get(f.event_id)!;
    const key = `${f.kind}:${f.reason}`;
    (g.devices[key] ||= new Set()).add(f.device_hash);
    if (f.note) g.notes.push(f.note);
  }
  const events = [...byEvent.values()].map(({ devices, ...g }) => ({
    ...g,
    reasons: Object.fromEntries(Object.entries(devices).map(([k, s]) => [k, s.size])),
  }));
  // Hidden events first (they need a decision), then most-reported.
  events.sort((a, b) => Number(b.status === "hidden") - Number(a.status === "hidden")
    || Object.values(b.reasons).reduce((x, y) => x + y, 0) - Object.values(a.reasons).reduce((x, y) => x + y, 0));
  return NextResponse.json({ events });
}

// { eventId, action: "dismiss" | "hide" | "restore" }
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { eventId, action } = await req.json().catch(() => ({}));
  if (typeof eventId !== "string" || !["dismiss", "hide", "restore"].includes(action)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const now = new Date().toISOString();
  if (action === "hide") {
    await supabase.from("events").update({ status: "hidden" }).eq("id", eventId);
    await supabase.from("event_flags").update({ status: "actioned" }).eq("event_id", eventId).eq("status", "open");
  } else {
    // "Looks fine" / "Restore": the listing stays, reports are dismissed, details count as checked.
    await supabase.from("events").update({
      status: "active", uncertain_fields: [], confidence: "high", verified_by: "admin", verified_at: now,
    }).eq("id", eventId);
    await supabase.from("event_flags").update({ status: "dismissed" })
      .eq("event_id", eventId).eq("status", "open").eq("kind", "report");
    await supabase.from("event_occurrences").update({ cancelled: false }).eq("event_id", eventId);
  }
  return NextResponse.json({ ok: true });
}
