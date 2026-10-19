"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  adProvider,
  ADSENSE_CLIENT,
  ETHICALADS_PUBLISHER,
  HOUSE_ADS,
} from "@/lib/ads";

declare global {
  interface Window {
    ethicalads?: { load?: () => void; wait?: Promise<unknown> };
    adsbygoogle?: unknown[];
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
 * A single ad placement. Cookieless by default.
 * `index` rotates which house ad shows; `slot` is the AdSense slot id.
 */
export default function AdUnit({
  index = 0,
  slot,
  className = "",
}: {
  index?: number;
  slot?: string;
  className?: string;
}) {
  const provider = adProvider();

  useEffect(() => {
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
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* ignore */
      }
    }
  }, [provider]);

  if (provider === "none") return null;

  // --- EthicalAds (contextual, cookieless) ---
  if (provider === "ethicalads" && ETHICALADS_PUBLISHER) {
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

  // --- Google AdSense (note: tracks users) ---
  if (provider === "adsense" && ADSENSE_CLIENT && slot) {
    return (
      <div className={className} aria-label="Advertisement" role="complementary">
        <ins
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    );
  }

  // --- House ad (default; zero external calls, zero tracking) ---
  const ad = HOUSE_ADS[index % HOUSE_ADS.length];
  const inner = (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-lg">{ad.badge ?? "✨"}</span>
        <span className="text-[10px] uppercase tracking-widest text-white/25">Sponsor</span>
      </div>
      <h3 className="text-sm font-semibold text-white">{ad.title}</h3>
      <p className="mt-1 flex-1 text-xs text-white/50">{ad.body}</p>
      <span className="mt-3 text-xs font-medium text-fuchsia-400">{ad.cta}</span>
    </div>
  );

  return (
    <div className={className} aria-label="Sponsor message" role="complementary">
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
