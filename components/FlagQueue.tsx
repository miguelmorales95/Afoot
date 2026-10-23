"use client";

// Admin: events people flagged, with one-click decisions.
import { useCallback, useEffect, useState } from "react";
import { HEADS_UP_REASONS, REPORT_REASONS, type FlaggedEvent } from "@/lib/types";

const LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(REPORT_REASONS).map(([k, v]) => [`report:${k}`, v])),
  ...Object.fromEntries(Object.entries(HEADS_UP_REASONS).map(([k, v]) => [`heads_up:${k}`, `Tip: ${v}`])),
};

const TOKEN_KEY = "afoot_admin_token";
const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };

export default function FlagQueue() {
  const [token] = useState(savedToken);
  const [events, setEvents] = useState<FlaggedEvent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const headers: Record<string, string> = token ? { "x-admin-token": token } : {};

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/flags", { headers: token ? { "x-admin-token": token } : {} });
    const data = await res.json().catch(() => ({}));
    setEvents(res.ok ? data.events ?? [] : []);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const act = async (eventId: string, action: "dismiss" | "hide" | "restore") => {
    setBusy(eventId);
    const res = await fetch("/api/admin/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ eventId, action }),
    });
    if (res.ok) setEvents((list) => (list || []).filter((e) => e.event_id !== eventId));
    setBusy(null);
  };

  if (!events || events.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Flagged events <span className="text-white/40">· {events.length}</span></h2>
      <p className="mt-1 text-sm text-white/50">
        Reports and disputed details from people using Afoot. Counts are distinct devices.
      </p>
      <div className="mt-4 space-y-3">
        {events.map((e) => (
          <div key={e.event_id} className={`rounded-2xl border p-4 ${e.status === "hidden" ? "border-red-500/30 bg-red-500/5" : "border-white/10 bg-white/[0.03]"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{e.title}</h3>
              {e.status === "hidden" && <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] text-red-300">Hidden by reports</span>}
              {e.uncertain_fields.length > 0 && <span className="text-[11px] text-amber-300">Unconfirmed: {e.uncertain_fields.join(", ")}</span>}
            </div>
            <p className="text-sm text-white/50">{e.venue}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(e.reasons).map(([k, n]) => (
                <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] ${k.startsWith("report") ? "bg-red-500/10 text-red-200" : "bg-white/5 text-white/60"}`}>
                  {LABELS[k] ?? k} · {n}
                </span>
              ))}
            </div>
            {e.notes.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm text-white/60">
                {e.notes.slice(0, 5).map((n, i) => <li key={i}>“{n}”</li>)}
              </ul>
            )}
            {e.research_notes && <p className="mt-2 text-xs text-white/35">Research note: {e.research_notes}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {(e.source_url || e.url) && (
                <a href={e.source_url || e.url || "#"} target="_blank" rel="noopener noreferrer" className="text-fuchsia-300 hover:underline">
                  Check source ↗
                </a>
              )}
              <span className="flex-1" />
              <button disabled={busy === e.event_id} onClick={() => act(e.event_id, e.status === "hidden" ? "restore" : "dismiss")}
                className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20 disabled:opacity-50">
                {e.status === "hidden" ? "Restore" : "Looks fine"}
              </button>
              {e.status !== "hidden" && (
                <button disabled={busy === e.event_id} onClick={() => act(e.event_id, "hide")}
                  className="rounded-full bg-red-600/80 px-3 py-1.5 font-medium hover:bg-red-600 disabled:opacity-50">
                  Hide event
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
