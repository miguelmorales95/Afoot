import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { demoNearby, isDemoMode } from "@/lib/demo";
import { hasLocalEvents, localNearby } from "@/lib/localEvents";

// GET /api/events?lat=..&lng=..&radius=15&days=30
// Returns upcoming event occurrences near a point, sorted by time.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") || "");
  const lng = parseFloat(sp.get("lng") || "");
  const radius = Math.min(parseFloat(sp.get("radius") || "15") || 15, 80);
  const days = Math.min(parseInt(sp.get("days") || "30", 10) || 30, 60);

  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  if (hasLocalEvents()) {
    return NextResponse.json({ events: localNearby(lat, lng, radius, days) });
  }

  if (isDemoMode()) {
    return NextResponse.json({ events: demoNearby(lat, lng, radius), demo: true });
  }

  const { data, error } = await supabase.rpc("nearby_events", {
    in_lat: lat,
    in_lng: lng,
    in_radius_km: radius,
    in_days_ahead: days,
  });

  if (error) {
    console.error("nearby_events error:", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}
