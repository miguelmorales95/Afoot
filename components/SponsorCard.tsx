"use client";

import { useState } from "react";
import { WHY_SPONSORED, type LiveCampaign } from "@/lib/ads";
import { useSeen } from "@/lib/sponsorClient";

/**
 * A paid sponsor card: same look as the house promos, plus the "Sponsored" disclosure
 * and a "Why am I seeing this?" note. The link goes through /go/<id> (counts a click).
 * `preview` (admin) draws it without the link or view counting.
 */
export default function SponsorCard({
  campaign,
  className = "",
  preview = false,
}: {
  campaign: Pick<LiveCampaign, "id" | "badge" | "title" | "body" | "cta">;
  className?: string;
  preview?: boolean;
}) {
  const seenRef = useSeen(preview ? null : campaign.id);
  const content = (
    <>
      <h3 className="text-sm font-semibold text-white">{campaign.title}</h3>
      {campaign.body && <p className="mt-1 text-xs text-white/50">{campaign.body}</p>}
      <span className="mt-3 block text-xs font-medium text-fuchsia-400">{campaign.cta || "Learn more →"}</span>
    </>
  );

  return (
    <div ref={seenRef} className={className} aria-label="Sponsored" role="complementary">
      <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-lg">{campaign.badge || "✨"}</span>
          <span className="text-[10px] uppercase tracking-widest text-white/40">Sponsored</span>
        </div>
        {preview ? (
          <div className="flex-1">{content}</div>
        ) : (
          // A plain <a> (not next/link) so nothing prefetches /go and counts a click.
          <a href={`/go/${campaign.id}`} rel="sponsored noopener" className="block flex-1">
            {content}
          </a>
        )}
        <WhySponsored />
      </div>
    </div>
  );
}

/** Small disclosure toggle; a button (not hover-only) so it works on phones. */
export function WhySponsored({ className = "mt-2" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`text-[10px] leading-snug text-white/30 ${className}`}>
      <button
        type="button"
        title={WHY_SPONSORED}
        aria-expanded={open}
        onClick={(e) => {
          // Featured events sit inside a link; don't follow it.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="underline-offset-2 hover:text-white/60 hover:underline"
      >
        Why am I seeing this?
      </button>
      {open && <p className="mt-1 text-white/50">{WHY_SPONSORED}</p>}
    </div>
  );
}
