"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HOUSE_ADS, campaignsFor, type LiveCampaign } from "@/lib/ads";
import { useLiveCampaigns, useSeen } from "@/lib/sponsorClient";
import { WhySponsored } from "./SponsorCard";
import SourceForm, { SOURCE_TYPES, type SourceType } from "./SourceForm";

// Cards that sit between the event posters, on purpose quieter than them:
//   - ads are newsprint (off-white, gray ink, "AD" up top), like a classified,
//   - asks are kraft paper with tear-off tickets down the right edge, like a "take one" flyer
//     (sideways, so it fits the feed). Each ticket opens the source popup with its type picked.
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
      body="An Instagram account, a newsletter you get, a venue's calendar page. Take a ticket and send it over; we'll start pulling events from it."
      tickets={TICKET_ORDER.map((t) => ({ label: SOURCE_TYPES[t].ticket, emoji: SOURCE_TYPES[t].label.split(" ")[0], type: t }))}
    />
  ) : (
    <AskCard
      eyebrow="Curators wanted"
      title="Post LA events on Instagram?"
      body="Become a Light Pole curator. We add the events you post, credited to your handle and linked back to your page."
      tickets={[
        { label: "I'm a curator", emoji: "🙋", type: "instagram", mine: true },
        { label: "Suggest one", emoji: "📸", type: "instagram" },
      ]}
    />
  );
}

/** Tickets down the sources flyer, top to bottom: one of each. */
const TICKET_ORDER: SourceType[] = ["instagram", "newsletter", "website"];
type Ticket = { label: string; emoji: string; type: SourceType; mine?: boolean };

function AskCard({ eyebrow, title, body, tickets }: { eyebrow: string; title: string; body: string; tickets: Ticket[] }) {
  const [open, setOpen] = useState<Ticket | null>(null);
  return (
    <div className="flyer flex pt-6" style={KRAFT} role="complementary" aria-label={eyebrow}>
      <div className="min-w-0 flex-1 px-4 pb-8 sm:px-6">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-black/55">{eyebrow}</p>
        <h3 className="mt-1 text-[20px] font-extrabold leading-tight text-[#2a2016] sm:text-[22px]">{title}</h3>
        <p className="mt-1 max-w-xl text-[14px] font-medium leading-snug text-black/70">{body}</p>
      </div>
      {/* Tear-off tickets: a dashed cut line, then one ticket per row, each its own button. */}
      {/* pb-4 keeps the last ticket clear of the next poster's overlap (.flyer-stack). */}
      <ul className="-mt-6 flex w-[122px] shrink-0 flex-col border-l-[1.5px] border-dashed border-black/40 pb-4 sm:w-[150px]">
        {tickets.map((t, i) => (
          <li key={i} className={`flex flex-1 ${i ? "border-t-[1.5px] border-dashed border-black/35" : ""}`}>
            <button
              type="button"
              onClick={() => setOpen(t)}
              className="flex min-h-11 flex-1 items-center gap-1.5 px-2.5 text-left text-[13px] font-extrabold leading-tight text-[#2a2016] transition-colors hover:bg-black/10 focus-visible:bg-black/10 focus-visible:outline-none active:bg-black/20"
            >
              <span aria-hidden>{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {open && <SourceSheet ticket={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** The source form in a popup over the feed (no page change, so going back is just closing it). */
function SourceSheet({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  // Portaled to <body>: the flyer is tilted (a transform), which would trap a fixed overlay inside it.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Share a source" onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#2b2119] p-5 pb-8 text-[#f3ece2] sm:rounded-3xl">
        <div className="flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-full px-2 text-2xl leading-none text-white/60 hover:text-white">×</button>
        </div>
        <SourceForm initialType={ticket.type} initialMine={!!ticket.mine} onClose={onClose} />
      </div>
    </div>,
    document.body,
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
