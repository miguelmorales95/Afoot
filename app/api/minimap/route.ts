import { NextRequest, NextResponse } from "next/server";
import { renderMiniMap } from "@/lib/minimap";

// GET /api/minimap?lat=34.0782&lng=-118.2606
// Tiny SVG street map for an event card. Streets barely change, so the response is
// cached hard; callers round coordinates to 4 decimals (~10 m) so venues share URLs.

export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }
  // Afoot only covers Southern California; refusing elsewhere stops anyone from making
  // this route fetch tiles for the whole planet.
  if (lat < 32.5 || lat > 35.5 || lng < -120.5 || lng > -114) {
    return NextResponse.json({ error: "outside the area Afoot covers" }, { status: 400 });
  }

  try {
    const svg = await renderMiniMap(Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=2592000, s-maxage=31536000, stale-while-revalidate=604800",
        // Street names come from OSM; never let the SVG run anything if opened directly.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "map unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
