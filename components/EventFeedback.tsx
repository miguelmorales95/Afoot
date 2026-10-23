"use client";

// Lets people help keep listings accurate, Craigslist-style but without accounts:
// a one-tap check on details we're unsure about, a ⚑ report menu, and "heads up"
// tips after an event (parking, crowds, great vibe). Each browser gets a random id
// (stored only in localStorage); the server keeps just a salted hash of it.
import { useEffect, useState } from "react";
import {
  HEADS_UP_REASONS, REPORT_REASONS,
  type HeadsUpReason, type NearbyEvent, type ReportReason, type UncertainField,
} from "@/lib/types";
import { formatShortDate, formatTime } from "@/lib/format";

const DEVICE_KEY = "afoot_device";
const ANSWERED_KEY = "afoot_answered";

const FIELD_LABEL: Record<UncertainField, string> = {
  starts_at: "Time unconfirmed", date: "Date unconfirmed", address: "Location unconfirmed", price: "Price unconfirmed",
};
const TIP_EMOJI: Record<HeadsUpReason, string> = {
  great_vibe: "✨", parking: "🚗", crowded: "👥", not_as_described: "🤔", not_accessible: "♿", unsafe: "⚠️",
};

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: still works, just not remembered
  }
}

function answered(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(ANSWERED_KEY) || "{}"); } catch { return {}; }
}
function remember(key: string) {
  try { localStorage.setItem(ANSWERED_KEY, JSON.stringify({ ...answered(), [key]: true })); } catch { /* ignore */ }
}

async function send(body: object): Promise<{ ok?: boolean; error?: string; hidden?: boolean; cancelled?: boolean }> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, deviceId: deviceId() }),
  });
  return res.json().catch(() => ({ error: "Couldn't save that." }));
}

const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };

/** Small amber labels for details we haven't confirmed. */
export function UnconfirmedBadges({ ev }: { ev: NearbyEvent }) {
  if (ev.cancelled) {
    return <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300 ring-1 ring-red-500/30">Reported cancelled</span>;
  }
  if (!ev.uncertain_fields?.length) return null;
  return (
    <>
      {ev.uncertain_fields.map((f) => (
        <span key={f} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300 ring-1 ring-amber-500/25">
          {FIELD_LABEL[f]}
        </span>
      ))}
    </>
  );
}

function question(ev: NearbyEvent, field: UncertainField): string {
  if (field === "starts_at") return `Does this start at ${formatTime(ev.starts_at)}?`;
  if (field === "date") return `Is this happening on ${formatShortDate(ev.starts_at)}?`;
  if (field === "address") return `Is it at ${ev.venue_address || ev.venue_name}?`;
  return `Is the price ${ev.price || "free"}?`;
}

export default function EventFeedback({ ev, enabled }: { ev: NearbyEvent; enabled: boolean }) {
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState("");
  const [thanks, setThanks] = useState<string | null>(null);
  const [askField, setAskField] = useState<UncertainField | null>(null);
  const started = new Date(ev.starts_at).getTime() < Date.now();
  const tips = Object.entries(ev.heads_up || {}).filter(([, n]) => (n ?? 0) > 0) as [HeadsUpReason, number][];

  // Ask about the first uncertain detail this browser hasn't answered yet.
  useEffect(() => {
    if (!enabled || ev.cancelled) return;
    const done = answered();
    setAskField(ev.uncertain_fields?.find((f) => !done[`${ev.event_id}:${f}`]) ?? null);
  }, [enabled, ev.event_id, ev.uncertain_fields, ev.cancelled]);

  const check = async (e: React.MouseEvent, answer: "yes" | "no" | "unsure") => {
    stop(e);
    if (!askField) return;
    remember(`${ev.event_id}:${askField}`);
    setAskField(null);
    const r = await send({ type: "check", eventId: ev.event_id, occurrenceId: ev.occurrence_id, field: askField, answer });
    setThanks(r.error || "Thanks, that helps everyone.");
  };

  const flag = async (e: React.MouseEvent, type: "report" | "heads_up", reason: ReportReason | HeadsUpReason) => {
    stop(e);
    setMenu(false);
    const r = await send({ type, eventId: ev.event_id, occurrenceId: ev.occurrence_id, reason, note: note || undefined });
    setNote("");
    setThanks(
      r.error ? r.error
        : r.hidden ? "Thanks. Enough people reported this, so it's hidden until we review it."
        : r.cancelled ? "Thanks. This date is now marked as cancelled."
        : type === "heads_up" ? "Thanks for the heads up!"
        : "Thanks. We'll take a look.",
    );
  };

  return (
    <div className="mt-2 space-y-2" onClick={(e) => menu && stop(e)}>
      {tips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tips.map(([reason, n]) => (
            <span key={reason} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/60" title="From people who went">
              {TIP_EMOJI[reason]} {HEADS_UP_REASONS[reason]} · {n}
            </span>
          ))}
        </div>
      )}

      {askField && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/5 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/15">
          <span>{question(ev, askField)}</span>
          {(["yes", "no", "unsure"] as const).map((a) => (
            <button key={a} type="button" onClick={(e) => check(e, a)}
              className="rounded-full bg-white/10 px-2.5 py-0.5 font-medium text-white/80 hover:bg-white/20">
              {a === "unsure" ? "Not sure" : a === "yes" ? "Yes" : "No"}
            </button>
          ))}
        </div>
      )}

      {thanks && <p className="text-xs text-emerald-300/80">{thanks}</p>}

      {enabled && (
        <div className="flex justify-end">
          <button type="button" onClick={(e) => { stop(e); setMenu(!menu); setThanks(null); }}
            className="text-xs text-white/35 hover:text-white/70" aria-expanded={menu} aria-label="Report or rate this event">
            ⚑ {started ? "Rate or report" : "Report"}
          </button>
        </div>
      )}

      {menu && (
        <div className="rounded-xl border border-white/10 bg-[#14141c] p-3 text-xs" onClick={stop}>
          {started && (
            <>
              <p className="mb-1.5 font-semibold text-white/70">How was it? (shown as tips to others)</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {(Object.keys(HEADS_UP_REASONS) as HeadsUpReason[]).map((r) => (
                  <button key={r} type="button" onClick={(e) => flag(e, "heads_up", r)}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-white/70 hover:bg-white/15">
                    {TIP_EMOJI[r]} {HEADS_UP_REASONS[r]}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="mb-1.5 font-semibold text-white/70">Report a problem with this listing</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
              <button key={r} type="button" onClick={(e) => flag(e, "report", r)}
                className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-200/90 hover:bg-red-500/20">
                {REPORT_REASONS[r]}
              </button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} onClick={stop} maxLength={500}
            placeholder="Optional: what's wrong? (e.g. it starts at 9, not 8)"
            className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-white/80 outline-none placeholder:text-white/30" />
          <p className="mt-2 text-[11px] text-white/35">No account needed. We don't store your IP or identity.</p>
        </div>
      )}
    </div>
  );
}
