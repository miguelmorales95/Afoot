"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  adProvider,
  ADSENSE_CLIENT,
  ADSENSE_PERSONALIZED,
  ETHICALADS_PUBLISHER,
  HOUSE_ADS,
  campaignsFor,
  type HouseAd,
} from "@/lib/ads";
import { useLiveCampaigns } from "@/lib/sponsorClient";
import SponsorCard from "./SponsorCard";

declare global {
  interface Window {
    ethicalads?: { load?: () => void; wait?: Promise<unknown> };
    adsbygoogle?: unknown[] & { requestNonPersonalizedAds?: number };
  }
}

function loadScriptOnce(id: string, src: string, attrs: Record<string, string> = {}) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.src = src;
  s.async = true;
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.appendChild(s);
}

/**
 * A single ad placement, filled in order so it's never empty:
 *   1. a paid local sponsor: a live "area_sponsor" campaign for `area` (the area the
 *      visitor is browsing), then campaigns for "all" areas,
 *   2. the ad network, if configured,
 *   3. a house promo (also shown when AdSense has no ad for the slot).
 * `index` picks which sponsor / promo; `slot` is the AdSense slot id.
 */
export default function AdUnit({
  index = 0,
  slot,
  area = null,
  className = "",
}: {
  index?: number;
  slot?: string;
  area?: string | null;
  className?: string;
}) {
  const provider = adProvider();
  const sponsor = campaignsFor(useLiveCampaigns(), "area_sponsor", area)[index] ?? null;
  const network = !sponsor && (
    (provider === "ethicalads" && !!ETHICALADS_PUBLISHER) || (provider === "adsense" && !!ADSENSE_CLIENT && !!slot)
  );

  useEffect(() => {
    if (!network) return;
    if (provider === "ethicalads" && ETHICALADS_PUBLISHER) {
      loadScriptOnce(
        "ethicalads-script",
        "https://media.ethicalads.io/media/client/ethicalads.min.js",
      );
      // Re-scan on mount (SPA navigation / view switches).
      const t = setTimeout(() => window.ethicalads?.load?.(), 300);
      return () => clearTimeout(t);
    }
    if (provider === "adsense" && ADSENSE_CLIENT) {
      loadScriptOnce(
        "adsense-script",
        `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`,
        { crossorigin: "anonymous" },
      );
      try {
        const q = (window.adsbygoogle = window.adsbygoogle || []);
        if (!ADSENSE_PERSONALIZED) q.requestNonPersonalizedAds = 1;
        q.push({});
      } catch {
        /* ignore */
      }
    }
  }, [provider, network]);

  if (provider === "none") return null;
  if (sponsor) return <SponsorCard key={sponsor.id} campaign={sponsor} className={className} />;

  // --- EthicalAds (contextual, cookieless) ---
  if (network && provider === "ethicalads") {
    return (
      <div
        className={className}
        role="complementary"
        aria-label="Advertisement"
        data-ea-publisher={ETHICALADS_PUBLISHER}
        data-ea-type="image"
        data-ea-style="stickybox"
      />
    );
  }

  // --- Google AdSense: if Google has no ad, it marks the slot "unfilled" and the house
  // promo underneath shows instead (see globals.css). ---
  if (network && provider === "adsense") {
    return (
      <div className={`ad-slot ${className}`} aria-label="Advertisement" role="complementary">
        <ins
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
        <HouseCard ad={HOUSE_ADS[index % HOUSE_ADS.length]} className="ad-fallback h-full" />
      </div>
    );
  }

  // --- House promo (zero external calls, zero tracking) ---
  return <HouseCard ad={HOUSE_ADS[index % HOUSE_ADS.length]} className={className} />;
}

function HouseCard({ ad, className = "", label = "From Afoot" }: { ad: HouseAd; className?: string; label?: string }) {
  const inner = (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-lg">{ad.badge ?? "✨"}</span>
        <span className="text-[10px] uppercase tracking-widest text-white/25">{label}</span>
      </div>
      <h3 className="text-sm font-semibold text-white">{ad.title}</h3>
      <p className="mt-1 flex-1 text-xs text-white/50">{ad.body}</p>
      <span className="mt-3 text-xs font-medium text-fuchsia-400">{ad.cta}</span>
    </div>
  );

  return (
    <div className={className} aria-label="Message from Afoot" role="complementary">
      {ad.href.startsWith("/") ? (
        <Link href={ad.href} className="block h-full">
          {inner}
        </Link>
      ) : (
        <a href={ad.href} rel="sponsored noopener" className="block h-full">
          {inner}
        </a>
      )}
    </div>
  );
}
