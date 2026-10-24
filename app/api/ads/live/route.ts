import { NextResponse } from "next/server";
import { liveCampaigns, publicCampaign } from "@/lib/campaigns";

// GET /api/ads/live — every live sponsor campaign (card text only). The browser picks the
// ones for the area it's showing, so no location is ever sent here, and the response is
// the same for everyone, which lets the CDN cache it.
export const dynamic = "force-dynamic";

export async function GET() {
  const campaigns = (await liveCampaigns()).map(publicCampaign);
  return NextResponse.json(
    { campaigns },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
  );
}
