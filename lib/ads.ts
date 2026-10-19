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

// House ads — shown with the "house" provider, or as a fallback when a network
// provider isn't configured. The first one sells the space itself.
export function advertiseMailto(): string {
  const subject = encodeURIComponent("Advertise on WhatsUp LA");
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
