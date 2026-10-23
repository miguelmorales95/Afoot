"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { NearbyEvent } from "@/lib/types";
import {
  categoryMeta,
  dayKey,
  formatDayLabel,
  formatDistance,
  formatTime,
} from "@/lib/format";
import AdRail from "@/components/AdRail";
import AdUnit from "@/components/AdUnit";
import EventsTable from "@/components/EventsTable";
import GoingButton from "@/components/GoingButton";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[70vh] animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
  ),
});

type View = "list" | "table" | "map";

interface Loc {
  lat: number;
  lng: number;
  label: string;
}

const STORAGE_KEY = "afoot_loc";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "music", label: "🎸 Music" },
  { key: "karaoke", label: "🎤 Karaoke" },
  { key: "games", label: "🎲 Games" },
  { key: "trivia", label: "🧠 Trivia" },
  { key: "comedy", label: "🎭 Comedy" },
  { key: "market", label: "🛍️ Markets" },
];

export default function Home() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [events, setEvents] = useState<NearbyEvent[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore last location on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Loc;
        setLoc(parsed);
        void loadEvents(parsed);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (l: Loc) => {
    setLoc(l);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
    } catch {
      /* ignore */
    }
  };

  const loadEvents = useCallback(async (l: Loc) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events?lat=${l.lat}&lng=${l.lng}&radius=25&days=45`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load events");
      setEvents(data.events as NearbyEvent[]);
    } catch (e) {
      setError((e as Error).message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error("Couldn't find that place — try a neighborhood or ZIP.");
      const l: Loc = { lat: data.lat, lng: data.lng, label: shortLabel(data.label, query) };
      persist(l);
      await loadEvents(l);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setError("Geolocation isn't available in this browser.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const l: Loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "your location",
        };
        persist(l);
        void loadEvents(l);
      },
      () => {
        setError("Couldn't get your location. Try searching a neighborhood instead.");
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.category === filter)),
    [events, filter],
  );

  // Group visible events by day, injecting an ad after the first day group.
  const grouped = useMemo(() => {
    const map = new Map<string, NearbyEvent[]>();
    for (const ev of visible) {
      const k = dayKey(ev.starts_at);
      const bucket = map.get(k);
      if (bucket) bucket.push(ev);
      else map.set(k, [ev]);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  return (
    <main className="mx-auto max-w-6xl px-4">
      {/* Hero / search */}
      <section className="hero-glow -mx-4 px-4 pt-10 pb-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            The small stuff happening near you.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-white/60">
            Karaoke, board game nights, open mics, neighborhood shows — the local events that
            never make it onto the big ticketing sites. No login, just your corner of LA.
          </p>

          <form onSubmit={search} className="mx-auto mt-6 flex max-w-lg flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Neighborhood, city, or ZIP (e.g. Echo Park)"
              className="flex-1 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm outline-none placeholder:text-white/30 focus:border-fuchsia-500/50"
            />
            <button
              type="submit"
              className="rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Find events
            </button>
          </form>
          <button
            onClick={useMyLocation}
            className="mt-3 text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
          >
            or use my current location
          </button>
        </div>
      </section>

      {/* Results + side ad rail (rail is desktop-only to keep phones light) */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div className="min-w-0">
      {/* Context + view switch + filters */}
      {loc && (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/50">
              Showing events near <span className="text-white/80">{loc.label}</span>
              {!loading && <span className="text-white/30"> · {visible.length} found</span>}
            </p>
            <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-0.5 text-xs font-medium">
              {(["list", "table", "map"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-full px-3 py-1 capitalize transition ${
                    view === v ? "bg-white text-black" : "text-white/60 hover:text-white"
                  }`}
                >
                  {v === "list" ? "📋 List" : v === "table" ? "🗂 Table" : "🗺 Map"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-white text-black"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {loading && <SkeletonFeed />}

      {!loading && loc && visible.length === 0 && <EmptyState hasLocation />}

      {!loading && !loc && !error && <EmptyState hasLocation={false} />}

      {!loading && loc && visible.length > 0 && view === "table" && (
        <EventsTable events={visible} />
      )}

      {!loading && loc && visible.length > 0 && view === "map" && (
        <EventsMap events={visible} center={[loc.lat, loc.lng]} />
      )}

      {!loading &&
        view === "list" &&
        grouped.map(([key, dayEvents], i) => (
          <div key={key} className="mb-8">
            <h2 className="sticky top-14 z-10 -mx-4 bg-[#0a0a0f]/90 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-white/40 backdrop-blur">
              {formatDayLabel(dayEvents[0].starts_at)}
            </h2>
            <div className="mt-2 space-y-3">
              {dayEvents.map((ev) => (
                <EventCard key={ev.occurrence_id} ev={ev} />
              ))}
            </div>
          </div>
        ))}

          {/* One unobtrusive house ad for mobile (rail is hidden there) */}
          {loc && visible.length > 0 && (
            <div className="mt-6 lg:hidden">
              <AdUnit index={0} className="min-h-[140px]" />
            </div>
          )}
        </div>

        <AdRail />
      </div>
    </main>
  );
}

function EventCard({ ev }: { ev: NearbyEvent }) {
  const cat = categoryMeta(ev.category);
  const body = (
    <div className="group flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.05]">
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-white/5 py-2 text-center">
        <div className="text-lg leading-none">{cat.emoji}</div>
        <div className="mt-1 text-xs font-semibold text-white/80">{formatTime(ev.starts_at)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-snug text-white group-hover:text-fuchsia-300">
            {ev.title}
          </h3>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${cat.className}`}
          >
            {cat.label}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-white/55">
          {ev.venue_name} · {formatDistance(ev.distance_km)} away
          {ev.price ? ` · ${ev.price}` : ""}
        </p>
        {ev.description && (
          <p className="mt-1 line-clamp-2 text-sm text-white/40">{ev.description}</p>
        )}
        {ev.tags && ev.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ev.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/50">
                {t}
              </span>
            ))}
          </div>
        )}
        {ev.is_recurring && ev.recurrence_description && (
          <p className="mt-1 text-xs text-white/30">🔁 {ev.recurrence_description}</p>
        )}
        <GoingButton ev={ev} />
      </div>
    </div>
  );

  return ev.url ? (
    <a href={ev.url} target="_blank" rel="noopener noreferrer" className="block">
      {body}
    </a>
  ) : (
    body
  );
}

function EmptyState({ hasLocation }: { hasLocation: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-16 text-center">
      <div className="text-4xl">{hasLocation ? "🫙" : "🗺️"}</div>
      <p className="mx-auto mt-3 max-w-sm text-white/60">
        {hasLocation
          ? "No events found nearby yet. We're still adding venues in your area — try widening your search or check back soon."
          : "Search a neighborhood or use your location to see what's happening near you."}
      </p>
    </div>
  );
}

function SkeletonFeed() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
      ))}
    </div>
  );
}

function shortLabel(displayName: string, fallback: string): string {
  // Nominatim returns "Echo Park, Los Angeles, CA, USA" — keep the first 2 parts.
  const parts = displayName.split(",").map((s) => s.trim());
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0] || fallback;
}
