"use client";

import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { demoAttendees, demoAddOutgoing } from "@/lib/socialDemo";
import type { Attendee, NearbyEvent } from "@/lib/types";

export default function AttendeesModal({ ev, onClose }: { ev: NearbyEvent; onClose: () => void }) {
  const { user, hasAuth, requireAuth } = useApp();
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      if (hasAuth && supabaseBrowser && !user?.demo) {
        const { data } = await supabaseBrowser.rpc("occurrence_attendees", {
          in_occurrence_id: ev.occurrence_id,
        });
        setAttendees((data as Attendee[]) ?? []);
      } else {
        setAttendees(demoAttendees(ev.occurrence_id, user ? { id: user.id, name: user.name } : undefined));
      }
    })();
  }, [ev.occurrence_id, hasAuth, user]);

  const request = async (a: Attendee) => {
    if (!user) return requireAuth();
    const note =
      typeof window !== "undefined"
        ? window.prompt(`Add a short note for ${a.display_name} (they approve before sharing contact):`, "")
        : "";
    if (note === null) return; // cancelled
    if (hasAuth && supabaseBrowser && !user.demo) {
      await supabaseBrowser.from("contact_requests").insert({
        recipient_id: a.user_id,
        occurrence_id: ev.occurrence_id,
        message: note || null,
      });
      setSent((s) => ({ ...s, [a.user_id]: "sent" }));
    } else {
      const r = demoAddOutgoing(a, ev.occurrence_id);
      setSent((s) => ({ ...s, [a.user_id]: r }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl border border-white/10 bg-[#14141b] p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">Who&apos;s going</h2>
            <p className="text-sm text-white/50">
              {ev.title} · {ev.venue_name}
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            ✕
          </button>
        </div>

        <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/50">
          🔒 Contact info is never shown here. Request it — they approve before anything is shared.
        </p>

        <ul className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto">
          {attendees === null && <li className="py-6 text-center text-white/40">Loading…</li>}
          {attendees?.length === 0 && (
            <li className="py-6 text-center text-white/40">No one yet — be the first!</li>
          )}
          {attendees?.map((a) => {
            const isSelf = user && a.user_id === user.id;
            return (
              <li key={a.user_id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5">
                <span className="flex items-center gap-2 text-sm text-white/80">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs">
                    {a.display_name.charAt(0).toUpperCase()}
                  </span>
                  {a.display_name} {isSelf && <span className="text-white/30">(you)</span>}
                </span>
                {!isSelf &&
                  (sent[a.user_id] ? (
                    <span className="text-xs text-emerald-300">
                      {sent[a.user_id] === "already" ? "already requested" : "request sent"}
                    </span>
                  ) : (
                    <button
                      onClick={() => request(a)}
                      className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
                    >
                      Request contact
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
