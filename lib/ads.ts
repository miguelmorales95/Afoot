// Privacy-first ad configuration.
//
// Philosophy (per product direction): NO user tracking, NO behavioral
// profiling, cookieless. Ads are contextual or house-sold only. This keeps the
// site light for old phones and respectful of visitors — "Craigslist for
// events."
//
// Providers:
//   "house"      — sponsor cards we control. Zero external scripts, zero
//                  tracking. The default, and how you bootstrap ad sales.
//   "ethicalads" — EthicalAds: contextual, cookieless, privacy-respecting.
//                  Set NEXT_PUBLIC_ETHICALADS_PUBLISHER. Recommended network.
//   "adsense"    — Google AdSense. Works, but it DOES track users; only use if
//                  you accept that tradeoff. Set NEXT_PUBLIC_ADSENSE_CLIENT.
//   "none"       — no ads.
import { SUGGEST_EMAIL } from "./site";
import { LAUNCH_AREAS } from "./areas";

export type AdProvider = "house" | "ethicalads" | "adsense" | "none";

export function adProvider(): AdProvider {
  const p = (process.env.NEXT_PUBLIC_AD_PROVIDER as AdProvider) || "house";
  return ["house", "ethicalads", "adsense", "none"].includes(p) ? p : "house";
}

export const ETHICALADS_PUBLISHER = process.env.NEXT_PUBLIC_ETHICALADS_PUBLISHER || "";
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT || "";

export interface HouseAd {
  title: string;
  body: string;
  href: string;
  cta: string;
  /** Optional emoji/badge shown in the corner. */
  badge?: string;
}

// Paid local sponsors, sold directly (a brewery, a venue, a business district), now live in
// the database (`afoot.campaigns`, managed in /admin) instead of a list here. Each slot
// shows a sponsor first, then the ad network (if configured), then the house promos
// below, so a slot is never empty.

export type CampaignProduct = "area_sponsor" | "featured_event";
export type CampaignStatus = "draft" | "approved" | "live" | "paused" | "ended";
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["draft", "approved", "live", "paused", "ended"];

/** What the browser gets for a live campaign: the card text, never the sponsor's
 *  contact details or price. Clicks go through /go/<id>, so `href` isn't needed here. */
export interface LiveCampaign {
  id: string;
  product: CampaignProduct;
  /** A launch-area name from lib/areas.ts, or "all". */
  area: string;
  event_id: string | null;
  badge: string | null;
  title: string;
  body: string | null;
  cta: string | null;
}

export const WHY_SPONSORED =
  "Afoot shows the same sponsor to everyone browsing this area. We don't track you.";

/** "Hermosa & Redondo" -> "hermosa-redondo"; used in UTM tags and report file names. */
export function areaSlug(area: string): string {
  return area.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "all";
}

// A visitor "is browsing" a launch area when they tapped its chip, or when the point they
// searched / their location is within this distance of one (nearest wins). Worked out in
// the browser; the area is never sent to the server.
const AREA_MATCH_KM = 6;

export function areaForLocation(loc: { lat: number; lng: number; label: string } | null): string | null {
  if (!loc) return null;
  const named = LAUNCH_AREAS.find((a) => a.name === loc.label);
  if (named) return named.name;
  let best: { name: string; km: number } | null = null;
  for (const a of LAUNCH_AREAS) {
    const km = haversineKm(loc.lat, loc.lng, a.lat, a.lng);
    if (km <= AREA_MATCH_KM && (!best || km < best.km)) best = { name: a.name, km };
  }
  return best?.name ?? null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Campaigns of one product that apply to an area: that area's own first, then "all".
 *  With no area (nothing picked yet) only "all" campaigns apply. */
export function campaignsFor(list: LiveCampaign[], product: CampaignProduct, area: string | null): LiveCampaign[] {
  const mine = list.filter((c) => c.product === product);
  return [...mine.filter((c) => area && c.area === area), ...mine.filter((c) => c.area === "all")];
}

// Google AdSense defaults to non-personalized ads (no profile-based targeting) to stay
// close to Afoot's privacy promise. Set NEXT_PUBLIC_ADSENSE_PERSONALIZED=1 to allow
// personalized ads (higher pay; needs a consent banner and a "Do Not Sell or Share" link).
export const ADSENSE_PERSONALIZED = process.env.NEXT_PUBLIC_ADSENSE_PERSONALIZED === "1";

/** True when nothing on the page uses an ad network (house ads and sponsors only). */
export function trackingFree(): boolean {
  const p = adProvider();
  return p === "house" || p === "none" || (p === "adsense" && !ADSENSE_CLIENT) || (p === "ethicalads");
}

// House promos: the last fallback for any slot. The first one sells the space itself.
export function advertiseMailto(): string {
  const subject = encodeURIComponent("Advertise on Afoot");
  return `mailto:${SUGGEST_EMAIL}?subject=${subject}`;
}

export const HOUSE_ADS: HouseAd[] = [
  {
    title: "Your spot here",
    body: "Reach locals hunting for something to do tonight. Simple, flat-rate, no tracking.",
    href: advertiseMailto(),
    cta: "Advertise with us →",
    badge: "📣",
  },
  {
    title: "Run events at your venue?",
    body: "Get your karaoke, trivia, and game nights in front of people nearby — free to list.",
    href: "/submit",
    cta: "Add your venue →",
    badge: "🍻",
  },
];
