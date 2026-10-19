"use client";

import { useMemo, useState } from "react";
import type { NearbyEvent } from "@/lib/types";
import {
  categoryMeta,
  formatDistance,
  formatShortDate,
  formatTime,
  priceValue,
} from "@/lib/format";

type SortKey = "when" | "title" | "venue" | "category" | "price" | "distance";
type Dir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "when", label: "When" },
  { key: "title", label: "Event" },
  { key: "venue", label: "Venue" },
  { key: "category", label: "Type" },
  { key: "price", label: "Price" },
  { key: "distance", label: "Distance" },
];

function valueFor(e: NearbyEvent, key: SortKey): string | number {
  switch (key) {
    case "when": return e.starts_at;
    case "title": return e.title.toLowerCase();
    case "venue": return e.venue_name.toLowerCase();
    case "category": return e.category ?? "zzz";
    case "price": return priceValue(e.price);
    case "distance": return e.distance_km;
  }
}

export default function EventsTable({ events }: { events: NearbyEvent[] }) {
  const [sort, setSort] = useState<SortKey>("when");
  const [dir, setDir] = useState<Dir>("asc");

  const sorted = useMemo(() => {
    const arr = [...events].sort((a, b) => {
      const va = valueFor(a, sort);
      const vb = valueFor(b, sort);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [events, sort, dir]);

  const toggle = (key: SortKey) => {
    if (key === sort) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir(key === "distance" || key === "price" ? "asc" : key === "when" ? "asc" : "asc");
    }
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03] text-left text-xs uppercase tracking-wider text-white/40">
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-4 py-3 font-medium">
                <button
                  onClick={() => toggle(col.key)}
                  className="inline-flex items-center gap-1 hover:text-white/80"
                >
                  {col.label}
                  <span className="text-[10px]">
                    {sort === col.key ? (dir === "asc" ? "▲" : "▼") : "↕"}
                  </span>
                </button>
              </th>
            ))}
            <th className="px-4 py-3 font-medium">Vibe</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const cat = categoryMeta(e.category);
            return (
              <tr
                key={e.occurrence_id}
                className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
              >
                <td className="whitespace-nowrap px-4 py-3 text-white/80">
                  <div className="font-medium">{formatShortDate(e.starts_at)}</div>
                  <div className="text-xs text-white/40">{formatTime(e.starts_at)}</div>
                </td>
                <td className="px-4 py-3">
                  {e.url ? (
                    <a
                      href={e.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-white hover:text-fuchsia-300"
                    >
                      {e.title}
                    </a>
                  ) : (
                    <span className="font-medium text-white">{e.title}</span>
                  )}
                  {e.is_recurring && e.recurrence_description && (
                    <div className="text-xs text-white/30">🔁 {e.recurrence_description}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-white/60">{e.venue_name}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cat.className}`}>
                    {cat.emoji} {cat.label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-white/70">{e.price ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-white/70">
                  {formatDistance(e.distance_km)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(e.tags ?? []).slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/50">
                        {t}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
