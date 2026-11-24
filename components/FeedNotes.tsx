"use client";

import Link from "next/link";
import { HOUSE_ADS, campaignsFor, type LiveCampaign } from "@/lib/ads";
import { useLiveCampaigns, useSeen } from "@/lib/sponsorClient";
import { WhySponsored } from "./SponsorCard";

// Cards that sit between the event posters, on purpose quieter than them:
//   - ads are newsprint (off-white, gray ink, "AD" up top), like a classified,
//   - asks are kraft paper with tear-off tabs, like a "help wanted" flyer on a pole.
// Both keep the .flyer staples and tilt so they still belong on the pole.

export type FeedNoteKind = "ad" | "ask-sources" | "ask-curators";
/** The order notes appear down the feed. */
export const FEED_NOTES: FeedNoteKind[] = ["ask-sources", "ad", "ask-curators", "ad"];

const NEWSPRINT = { "--paper": "#e8e3d6", "--tilt": "-0.3deg" } as React.CSSProperties;
const KRAFT = { "--paper": "#cdae7e", "--tilt": "0.4deg" } as React.CSSProperties;

export function FeedNote({ kind, n, area }: { kind: FeedNoteKind; n: number; area: string | null }) {
  if (kind === "ad") return <FeedAd n={n} area={area} />;
  return kind === "ask-sources" ? (
    <AskCard
      eyebrow="Help us fill the pole"
      title="Know where LA events get posted?"
      body="A newsletter you get, a venue's calendar page, a site we're missing. Send it over and we'll start pulling events from it."
      tabs={[
        { label: "Share a newsletter", href: "/submit?kind=source&type=newsletter" },
        { label: "Share a website", href: "/submit?kind=source&type=website" },
      ]}
    />
  ) : (
    <AskCard
      eyebrow="Curators wanted"
      title="Post LA events on Instagram?"
      body="Become a Light Pole curator. We add the events you post, credited to your handle and linked back to your page."
      tabs={[
        { label: "I'm a curator", href: "/submit?kind=source&type=instagram&mine=1" },
        { label: "Suggest an account", href: "/submit?kind=source&type=instagram" },
      ]}
    />
  );
}

function AskCard({ eyebrow, title, body, tabs }: { eyebrow: string; title: string; body: string; tabs: { label: string; href: string }[] }) {
  return (
    // Bottom padding clears the next poster's overlap (.flyer-stack), so the tabs stay whole.
    <div className="flyer px-4 pb-4 pt-6 sm:px-6" style={KRAFT} role="complementary" aria-label={eyebrow}>
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-black/55">{eyebrow}</p>
      <h3 className="mt-1 text-[20px] font-extrabold leading-tight text-[#2a2016] sm:text-[22px]">{title}</h3>
      <p className="mt-1 max-w-xl text-[14px] font-medium leading-snug text-black/70">{body}</p>
      {/* Tear-off tabs: each is a link. */}
      <div className="-mx-4 mt-4 flex border-t-[1.5px] border-dashed border-black/35 sm:-mx-6">
        {tabs.map((t, i) => (
          <Link
            key={t.href}
            href={t.href}
            className={`flex min-h-12 flex-1 items-center justify-center px-2 py-3 text-center text-[13px] font-extrabold text-[#2a2016] hover:bg-black/10 ${
              i ? "border-l-[1.5px] border-dashed border-black/35" : ""
            }`}
          >
            {t.label} →
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A paid area sponsor if there is one for this slot, else the "your spot here" house ad. */
function FeedAd({ n, area }: { n: number; area: string | null }) {
  const sponsor = campaignsFor(useLiveCampaigns(), "area_sponsor", area)[n] ?? null;
  // The desktop rail already carries ads; in the feed they're for phones and tablets.
  return <div className="lg:hidden">{sponsor ? <SponsorAd c={sponsor} /> : <HouseAd />}</div>;
}

function AdFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flyer px-4 pb-5 pt-6 sm:px-6" style={NEWSPRINT}>
      <div className="flex items-center justify-between border-b border-black/20 pb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/50">{label}</span>
      </div>
      {children}
    </div>
  );
}

function SponsorAd({ c }: { c: LiveCampaign }) {
  const seenRef = useSeen(c.id);
  return (
    <div ref={seenRef} role="complementary" aria-label="Sponsored">
      <AdFrame label="Sponsored">
        {/* A plain <a> so nothing prefetches /go and counts a click. */}
        <a href={`/go/${c.id}`} rel="sponsored noopener" target="_blank" className="mt-2 flex gap-3">
          {c.badge && <span className="text-2xl leading-none">{c.badge}</span>}
          <span className="min-w-0">
            <span className="block text-[17px] font-bold leading-tight text-[#222]">{c.title}</span>
            {c.body && <span className="mt-1 block text-[13px] leading-snug text-black/65">{c.body}</span>}
            <span className="mt-2 block text-[13px] font-bold text-[#222] underline underline-offset-2">{c.cta || "Learn more"}</span>
          </span>
        </a>
        <WhySponsored className="mt-2" />
      </AdFrame>
    </div>
  );
}

function HouseAd() {
  const ad = HOUSE_ADS[0];
  return (
    <div role="complementary" aria-label="Advertise on Light Pole">
      <AdFrame label="Ad · From Light Pole">
        <a href={ad.href} className="mt-2 flex gap-3">
          <span className="text-2xl leading-none">{ad.badge}</span>
          <span className="min-w-0">
            <span className="block text-[17px] font-bold leading-tight text-[#222]">{ad.title}</span>
            <span className="mt-1 block text-[13px] leading-snug text-black/65">{ad.body}</span>
            <span className="mt-2 block text-[13px] font-bold text-[#222] underline underline-offset-2">{ad.cta.replace(/\s*→$/, "")}</span>
          </span>
        </a>
      </AdFrame>
    </div>
  );
}
