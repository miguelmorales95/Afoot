"use client";

import Link from "next/link";
import { useApp } from "./AppProvider";
import type { NearbyEvent } from "@/lib/types";

// RSVP control. Attendance is private — there is NO count shown here. Going is
// what unlocks the event chat, so once you're in we surface the chat link.
export default function GoingButton({ ev, compact = false }: { ev: NearbyEvent; compact?: boolean }) {
  const { goingSet, toggleGoing } = useApp();
  const going = goingSet.has(ev.occurrence_id);
  const chatHref = `/chat/${ev.occurrence_id}?t=${encodeURIComponent(ev.title)}&v=${encodeURIComponent(ev.venue_name)}`;

  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "mt-2"}`}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleGoing(ev.occurrence_id);
        }}
        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
          going
            ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
            : "bg-white/10 text-white/80 hover:bg-white/20"
        }`}
      >
        {going ? "✓ Going" : "I'm going"}
      </button>
      {going && (
        <Link
          href={chatHref}
          onClick={(e) => e.stopPropagation()}
          className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/20"
        >
          💬 Chat
        </Link>
      )}
    </div>
  );
}
