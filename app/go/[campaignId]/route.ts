import { NextRequest, NextResponse } from "next/server";
import { areaSlug } from "@/lib/ads";
import { bumpCampaign, isBot, isUuid, liveCampaigns } from "@/lib/campaigns";

// GET /go/<campaignId> — a sponsor card's link. Adds 1 click for today, then redirects
// to the sponsor's page with UTM tags so the visit shows up in *their* analytics.
// Stores nothing about the visitor. Unknown, paused or ended campaigns go to the home page.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const campaign = isUuid(campaignId)
    ? (await liveCampaigns()).find((c) => c.id === campaignId.toLowerCase())
    : undefined;
  const target = campaign ? destination(campaign.href, campaign.area) : null;
  if (!campaign || !target) return redirect("/");

  if (!isBot(req.headers.get("user-agent"))) await bumpCampaign(campaign.id, 0, 1);
  return redirect(target);
}

// 302 and no-store, so every click comes back through here instead of a cached redirect.
// On-site targets use a relative Location, so it never depends on the server's own host.
function redirect(location: string) {
  return new NextResponse(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** The sponsor's link plus UTM tags. Their own query params stay; if they already set a
 *  utm_* value themselves, theirs wins. Site-relative links ("/submit") get no tags. */
function destination(href: string, area: string): string | null {
  if (/^\/(?![/\\])/.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const tags = { utm_source: "afoot", utm_medium: "sponsor", utm_campaign: areaSlug(area) };
    for (const [k, v] of Object.entries(tags)) if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    return url.toString();
  } catch {
    return null;
  }
}
