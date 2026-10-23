import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/geocode";
import { demoGeocode, isDemoMode } from "@/lib/demo";
import { hasLocalEvents } from "@/lib/localEvents";

// GET /api/geocode?q=Echo Park
// Server-side proxy to Nominatim (keeps the required User-Agent/email server-side
// and avoids browser CORS). Used by the search box.

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  // In demo mode, resolve against a small built-in LA gazetteer (works offline).
  // Local-file mode holds real events across LA, so it uses real geocoding.
  if (isDemoMode() && !hasLocalEvents()) {
    return NextResponse.json(demoGeocode(q));
  }

  try {
    // Bias toward LA-area results for bare neighborhood names.
    const query = /\b(ca|california|\d{5})\b/i.test(q) ? q : `${q}, Los Angeles, CA`;
    const geo = await geocode(query);
    if (!geo) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(geo, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return NextResponse.json({ error: "geocode failed" }, { status: 502 });
  }
}
