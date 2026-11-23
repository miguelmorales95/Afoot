import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isBot, isUuid } from "@/lib/campaigns";

// POST /api/events/seen — { v: [eventId, …], c: [eventId, …] }, sent with navigator.sendBeacon
// (lib/eventStatsClient.ts). Adds 1 view per id in v and 1 click per id in c for today, in one
// database call. Stores counts only: no IP, cookie, device id or user agent.
export const dynamic = "force-dynamic";

const MAX_IDS = 100;

const ids = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter(isUuid).map((id) => id.toLowerCase()))] : []);

export async function POST(req: NextRequest) {
  const done = new NextResponse(null, { status: 204 }); // a beacon can't read the response
  if (isBot(req.headers.get("user-agent"))) return done;
  const text = await req.text().catch(() => "");
  if (text.length > 20000) return done;
  let body: { v?: unknown; c?: unknown };
  try { body = JSON.parse(text); } catch { return done; }
  const v = ids(body.v), c = ids(body.c);
  if ((!v.length && !c.length) || v.length > MAX_IDS || c.length > MAX_IDS) return done;
  const { error } = await supabase.rpc("bump_event_daily", { p_views: v, p_clicks: c });
  if (error) console.warn("bump_event_daily failed:", error.message);
  return done;
}
