"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { NearbyEvent } from "@/lib/types";

const EventsMap = dynamic(() => import("./EventsMap"), {
  ssr: false,
  loading: () => <div className="h-[60vh] animate-pulse rounded-2xl bg-white/[0.04]" />,
});

/** A full map of the venue, opened from a card's thumbnail. Rendered on <body>: cards are tilted links. */
export default function VenueMapModal({ ev, onClose }: { ev: NearbyEvent; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const directions = `https://www.google.com/maps/dir/?api=1&destination=${ev.venue_lat},${ev.venue_lng}`;

  return createPortal(
    // React events bubble through portals to the card's link: stop them here.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Map of ${ev.venue_name}`}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-[#2b2119] p-4 pb-6 sm:rounded-3xl"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-poster text-2xl uppercase leading-tight text-[#fff23a]">{ev.venue_name}</h2>
            {ev.venue_address && <p className="mt-0.5 text-sm text-white/70">{ev.venue_address}</p>}
          </div>
          <button onClick={onClose} aria-label="Close map" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>
        <EventsMap events={[ev]} center={[ev.venue_lat, ev.venue_lng]} height="55vh" />
        <a
          href={directions}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block rounded-full bg-[#fff23a] px-5 py-3 text-center text-sm font-extrabold text-[#111] hover:bg-[#fff58a]"
        >
          Directions
        </a>
      </div>
    </div>,
    document.body,
  );
}
