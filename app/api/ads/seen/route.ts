import { NextRequest, NextResponse } from "next/server";
import { bumpCampaign, isBot, isUuid, liveCampaigns } from "@/lib/campaigns";

// POST /api/ads/seen — { ids: [campaignId, …] }, sent with navigator.sendBeacon when a
// page is hidden. Each id is a sponsor card that was at least half on screen during that
// page view. Adds 1 view per id for today; stores nothing else (no IP, cookie, device id
// or user agent).
export const dynamic = "force-dynamic";

const MAX_IDS = 10;

export async function POST(req: NextRequest) {
  // Always 204: a beacon can't read the response, and bots learn nothing from it.
  const done = new NextResponse(null, { status: 204 });
  if (isBot(req.headers.get("user-agent"))) return done;

  // sendBeacon posts text/plain (no CORS preflight), so parse the body ourselves.
  const text = await req.text().catch(() => "");
  if (text.length > 2000) return done;
  let ids: unknown;
  try {
    ids = (JSON.parse(text) as { ids?: unknown }).ids;
  } catch {
    return done;
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return done;

  const live = new Set((await liveCampaigns()).map((c) => c.id));
  const valid = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))].filter((id) => live.has(id));
  await Promise.all(valid.map((id) => bumpCampaign(id, 1, 0)));
  return done;
}
