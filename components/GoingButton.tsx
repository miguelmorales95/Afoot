"use client";

import { useEffect, useRef } from "react";
import { useApp } from "./AppProvider";
import type { NearbyEvent } from "@/lib/types";

export default function GoingButton({
  ev,
  onShowAttendees,
  compact = false,
}: {
  ev: NearbyEvent;
  onShowAttendees?: (ev: NearbyEvent) => void;
  compact?: boolean;
}) {
  const { ready, user, goingSet, toggleGoing } = useApp();
  const going = goingSet.has(ev.occurrence_id);

  // Capture whether the user was already counted at load, to display an
  // accurate optimistic count. Recapture when the signed-in user changes.
  const initial = useRef<boolean | null>(null);
  const capturedFor = useRef<string | null>(null);
  useEffect(() => {
    if (ready && capturedFor.current !== (user?.id ?? null)) {
      initial.current = goingSet.has(ev.occurrence_id);
      capturedFor.current = user?.id ?? null;
    }
  }, [ready, user, goingSet, ev.occurrence_id]);

  const base = ev.going_count ?? 0;
  const init = initial.current ?? false;
  const count = base + (going === init ? 0 : going ? 1 : -1);

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
      {count > 0 && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onShowAttendees?.(ev);
          }}
          className="text-xs text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
        >
          👥 {count} going
        </button>
      )}
    </div>
  );
}
