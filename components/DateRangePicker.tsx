"use client";

import { useRef, useState } from "react";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Keys are LA dates as YYYY-MM-DD; noon LA keeps date math off the day edges.
const atNoon = (key: string) => new Date(`${key}T20:00:00Z`);
const keyOf = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function DateRangePicker({
  min,
  max,
  start,
  end,
  counts,
  onChange,
  onClose,
}: {
  min: string;
  max: string;
  start: string;
  end: string;
  counts: Record<string, number>;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const s0 = atNoon(start);
  const [month, setMonth] = useState({ y: s0.getUTCFullYear(), m: s0.getUTCMonth() });
  // First tap of a two-tap pick, or the day a drag started on.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ from: string; downOn: string; at: string; moved: boolean; second: boolean } | null>(null);

  const first = new Date(Date.UTC(month.y, month.m, 1, 20));
  const daysIn = new Date(Date.UTC(month.y, month.m + 1, 0, 20)).getUTCDate();
  const cells: (string | null)[] = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= daysIn; d++) cells.push(keyOf(month.y, month.m, d));

  const minD = atNoon(min), maxD = atNoon(max);
  const canPrev = month.y > minD.getUTCFullYear() || month.m > minD.getUTCMonth();
  const canNext = month.y < maxD.getUTCFullYear() || month.m < maxD.getUTCMonth();
  const shift = (n: number) =>
    setMonth(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }));

  // While picking, preview anchor→hover; otherwise show the current range.
  const [lo, hi] = anchor
    ? [anchor, hover ?? anchor].sort()
    : [start, end];

  const commit = (a: string, b: string) => {
    const [x, y] = [a, b].sort();
    setAnchor(null);
    setHover(null);
    onChange(x, y);
    onClose();
  };

  const dayAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-day]")?.dataset.day;
  const inBounds = (k: string) => k >= min && k <= max;

  const onDown = (e: React.PointerEvent) => {
    const k = dayAt(e.clientX, e.clientY);
    if (!k || !inBounds(k)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { from: anchor ?? k, downOn: k, at: k, moved: false, second: anchor !== null };
    if (!anchor) setAnchor(k);
    setHover(k);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = dayAt(e.clientX, e.clientY);
    if (k && inBounds(k) && k !== d.at) {
      d.at = k;
      if (k !== d.downOn) d.moved = true;
      setHover(k);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // A drag, or the second tap, sets the range; a lone first tap waits for the end day.
    if (d.moved || d.second) commit(d.from, d.at);
  };

  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first);

  return (
    <div className="mb-2 rounded-3xl border border-white/10 bg-[#2b2119] p-4 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 hover:bg-white/10 disabled:opacity-25">‹</button>
        <p className="text-sm font-semibold">{title}</p>
        <button onClick={() => shift(1)} disabled={!canNext} aria-label="Next month"
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/80 hover:bg-white/10 disabled:opacity-25">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-white/35">
        {WEEKDAYS.map((w, i) => <div key={i} className="py-1">{w}</div>)}
      </div>
      <div
        className="grid select-none grid-cols-7 gap-y-1"
        style={{ touchAction: "none" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { drag.current = null; }}
      >
        {cells.map((k, i) => {
          if (!k) return <div key={`b${i}`} />;
          const off = !inBounds(k);
          const inRange = k >= lo && k <= hi;
          const edge = k === lo || k === hi;
          const n = counts[k] ?? 0;
          return (
            <div
              key={k}
              data-day={k}
              aria-disabled={off}
              className={`relative flex h-10 flex-col items-center justify-center text-sm ${
                off ? "text-white/15" : "cursor-pointer"
              } ${inRange && !off ? "bg-[#ffe45c]/15" : ""} ${k === lo ? "rounded-l-full" : ""} ${k === hi ? "rounded-r-full" : ""}`}
            >
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${
                edge && !off ? "bg-[#ffe45c] font-semibold text-[#1a1a1a]" : off ? "" : "text-white/85"
              }`}>
                {Number(k.slice(8))}
              </span>
              {n > 0 && !edge && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[#ffe45c]/70" />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-white/45">
        <span>{anchor ? "Now tap the last day" : "Tap a start and end day, or drag"}</span>
        <button onClick={onClose} className="rounded-full px-3 py-1 font-medium text-white/70 hover:bg-white/10">Close</button>
      </div>
    </div>
  );
}
