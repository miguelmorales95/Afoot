"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { NearbyEvent } from "@/lib/types";
import {
  categoryMeta,
  dayKey,
  formatDayLabel,
  formatDistance,
  formatShortDate,
  formatTime,
} from "@/lib/format";
import AdRail from "@/components/AdRail";
import AdUnit from "@/components/AdUnit";
import GoingButton from "@/components/GoingButton";
import EventFeedback, { UnconfirmedBadges } from "@/components/EventFeedback";
import VenueMiniMap from "@/components/VenueMiniMap";
import DateRangePicker from "@/components/DateRangePicker";
import { LAUNCH_AREAS, type LaunchArea } from "@/lib/areas";
import { areaForLocation, campaignsFor, type LiveCampaign } from "@/lib/ads";
import { useLiveCampaigns, useSeen } from "@/lib/sponsorClient";
import { countClick, observeEventView } from "@/lib/eventStatsClient";
import { WhySponsored } from "@/components/SponsorCard";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
  ssr: false,
  loading: () => (
    <div className="h-[70vh] animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
  ),
});

type View = "list" | "map";

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

const PAGE = 25;

export default function Home() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [events, setEvents] = useState<NearbyEvent[]>([]);
  const [feedback, setFeedback] = useState(false); // flags/checks need the database
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroOpen, setHeroOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapRange, setMapRange] = useState<{ start: string; end: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSheetOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

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
    setHeroOpen(false);
    setSheetOpen(false);
    window.scrollTo({ top: 0 });
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
      setFeedback(Boolean(data.feedback));
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

  const pickArea = (a: LaunchArea) => {
    const l: Loc = { lat: a.lat, lng: a.lng, label: a.name };
    setQuery("");
    persist(l);
    void loadEvents(l);
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

  // The launch area being browsed (chip, or a search/location near one): picks the area
  // sponsor and featured events. Worked out here; never sent anywhere.
  const area = areaForLocation(loc);
  const campaigns = useLiveCampaigns();

  // Featured events (paid): the next date of each featured event in these results is
  // pinned above the day list (list view only), labeled "Featured" and "Sponsored".
  const featured = useMemo(() => {
    const out: { ev: NearbyEvent; campaign: LiveCampaign }[] = [];
    for (const c of campaignsFor(campaigns, "featured_event", area)) {
      const ev = visible.find((e) => e.event_id === c.event_id && !e.cancelled);
      if (ev && !out.some((f) => f.ev.event_id === ev.event_id)) out.push({ ev, campaign: c });
    }
    return out.slice(0, 3);
  }, [campaigns, area, visible]);

  // Group visible events by day, injecting an ad after the first day group.
  const grouped = useMemo(() => {
    const pinned = new Set(featured.map((f) => f.ev.occurrence_id));
    const map = new Map<string, NearbyEvent[]>();
    for (const ev of visible) {
      if (pinned.has(ev.occurrence_id)) continue;
      // A run that started before today (a play through Nov 29) belongs under today, not its first night.
      const k = eventDay(ev);
      const bucket = map.get(k);
      if (bucket) bucket.push(ev);
      else map.set(k, [ev]);
    }
    for (const bucket of map.values()) bucket.sort((x, y) => (y.traffic_score ?? 0) - (x.traffic_score ?? 0));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visible, featured]);

  // Each day shows its top 25 by traffic; "View more" adds 25, and the third click shows all.
  const [shown, setShown] = useState<Record<string, number>>({});
  useEffect(() => setShown({}), [events, filter]);
  const showDay = (key: string, n: number) => {
    const shrinking = n < (shown[key] ?? PAGE);
    setShown((s) => ({ ...s, [key]: n }));
    if (shrinking) document.getElementById(`day-${key}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  const scrollToControls = () =>
    requestAnimationFrame(() => controlsRef.current?.scrollIntoView({ block: "start" }));

  const openMap = (day?: string) => {
    const d = day ?? todayKey();
    setMapRange({ start: d, end: d });
    setPickerOpen(false);
    setView("map");
    scrollToControls();
  };

  const pickFilter = (key: string, fromSheet = false) => {
    setFilter(key);
    if (fromSheet) {
      setSheetOpen(false);
      scrollToControls();
    }
  };

  const rangeStart = mapRange?.start ?? todayKey();
  const rangeEnd = mapRange?.end ?? rangeStart;
  const lastDay = grouped.length ? grouped[grouped.length - 1][0] : todayKey();
  const mapEvents = useMemo(
    () => visible.filter((e) => { const k = eventDay(e); return k >= rangeStart && k <= rangeEnd; }),
    [visible, rangeStart, rangeEnd],
  );
  const dayCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of visible) { const k = eventDay(e); c[k] = (c[k] ?? 0) + 1; }
    return c;
  }, [visible]);
  // The arrows move the whole window: a single day steps a day, a weekend steps to the next span.
  const rangeLen = daysBetween(rangeStart, rangeEnd) + 1;
  const stepRange = (dir: 1 | -1) => {
    const shifted = shiftDay(rangeStart, dir * rangeLen);
    const start = shifted < todayKey() ? todayKey() : shifted;
    setMapRange({ start, end: shiftDay(start, rangeLen - 1) });
  };

  const searchForm = (
    <form onSubmit={search} className="relative mx-auto w-full max-w-lg">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Neighborhood, city, or ZIP"
        aria-label="Neighborhood, city, or ZIP"
        className="w-full rounded-full border border-white/10 bg-white/5 py-3 pl-5 pr-24 text-sm outline-none placeholder:text-white/30 focus:border-[#ffe45c]/60"
      />
      <button
        type="submit"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-[#ffe45c] px-4 py-2 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff08a]"
      >
        Search
      </button>
    </form>
  );

  const areaChips = (
    <div className="flex flex-wrap justify-center gap-1.5" aria-label="Neighborhoods">
      {LAUNCH_AREAS.map((a) => (
        <button
          key={a.name}
          type="button"
          onClick={() => pickArea(a)}
          className={`rounded-full px-3 py-1 text-xs transition ${
            loc?.label === a.name ? "bg-[#ffe45c] text-[#1a1a1a]" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
          }`}
        >
          {a.name}
        </button>
      ))}
    </div>
  );

  const typeChips = (fromSheet: boolean) => (
    <div className={`flex flex-wrap gap-1.5 ${fromSheet ? "justify-center" : ""}`} aria-label="Event types">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => pickFilter(f.key, fromSheet)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            filter === f.key ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl px-4">
      {/* Top: full search until a place is picked, then one line; tapping the place reopens it. */}
      {!loc || heroOpen ? (
        <section className="hero-glow -mx-4 px-4 pt-10 pb-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              What&apos;s posted around LA.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-pretty text-white/60">
              Shows, markets, game nights, open mics and the small stuff that never makes the big
              ticketing sites, all on one pole. No login, just your corner of LA.
            </p>
            <div className="mt-6">{searchForm}</div>
            <button
              onClick={useMyLocation}
              className="mt-3 text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline"
            >
              or use my current location
            </button>
            <div className="mx-auto mt-4 max-w-2xl">{areaChips}</div>
            {loc && (
              <button
                onClick={() => setHeroOpen(false)}
                className="mt-4 text-xs text-white/40 underline-offset-4 hover:text-white/70 hover:underline"
              >
                Keep {placeName(loc)}
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="pt-5 pb-4">
          <button
            onClick={() => setHeroOpen(true)}
            aria-label={`Change place (now ${placeName(loc)})`}
            className="font-poster text-left text-[26px] uppercase leading-tight sm:text-3xl"
          >
            What&apos;s posted around{" "}
            <span className="whitespace-nowrap text-[#fff23a] underline decoration-[#fff23a]/50 decoration-2 underline-offset-4">
              {placeName(loc)}
              <span className="ml-1 text-base text-[#ffe45c]/70" aria-hidden>▾</span>
            </span>
          </button>
        </section>
      )}

      {/* Results + side ad rail (rail is desktop-only to keep phones light) */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
        <div className="min-w-0">
      {loc && (
        <div ref={controlsRef} className="mb-4 flex scroll-mt-16 items-start gap-3">
          <div className="flex shrink-0 flex-col gap-0.5 rounded-2xl border border-white/10 bg-white/5 p-0.5 text-xs font-medium" aria-label="View">
            {(["list", "map"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => (v === "map" ? openMap() : setView("list"))}
                aria-pressed={view === v}
                className={`rounded-xl px-3 py-1 text-left transition ${
                  view === v ? "bg-white text-black" : "text-white/60 hover:text-white"
                }`}
              >
                {v === "list" ? "📋 List" : "🗺 Map"}
              </button>
            ))}
          </div>
          {typeChips(false)}
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

      {!loading && loc && visible.length > 0 && view === "map" && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2 rounded-full border border-white/10 bg-white/5 p-1">
            <button
              onClick={() => stepRange(-1)}
              disabled={rangeStart <= todayKey()}
              aria-label={rangeLen === 1 ? "Previous day" : "Previous dates"}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-white/80 hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
            >
              ‹
            </button>
            <button
              onClick={() => setPickerOpen((o) => !o)}
              aria-expanded={pickerOpen}
              aria-label="Pick dates"
              className="rounded-full px-3 py-1 text-sm font-semibold hover:bg-white/10"
            >
              <span aria-live="polite">
                {rangeLen === 1 ? formatDayLabel(dayIso(rangeStart)) : `${monthDay(rangeStart)} – ${monthDay(rangeEnd)}`}
              </span>
              <span className="ml-1 text-xs text-white/40" aria-hidden>▾</span>
              <span className="ml-2 font-normal text-white/40">
                {mapEvents.length === 0 ? "nothing posted" : `${mapEvents.length} ${mapEvents.length === 1 ? "event" : "events"}`}
              </span>
            </button>
            <button
              onClick={() => stepRange(1)}
              disabled={rangeEnd >= lastDay}
              aria-label={rangeLen === 1 ? "Next day" : "Next dates"}
              className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-white/80 hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent"
            >
              ›
            </button>
          </div>
          {pickerOpen && (
            <DateRangePicker
              min={todayKey()}
              max={lastDay}
              start={rangeStart}
              end={rangeEnd}
              counts={dayCounts}
              onChange={(start, end) => setMapRange({ start, end })}
              onClose={() => setPickerOpen(false)}
            />
          )}
          <EventsMap events={mapEvents} center={[loc.lat, loc.lng]} />
        </div>
      )}

      {!loading && view === "list" && featured.length > 0 && (
        <div className="mb-8">
          <h2 className="py-2 text-sm font-semibold uppercase tracking-wider text-white/40">Featured</h2>
          <div className="flyer-stack mt-2">
            {(() => {
              const colors = posterColors(featured.map((f) => f.ev));
              return featured.map(({ ev, campaign }, i) => (
                <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} featured={campaign} paper={colors[i]} />
              ));
            })()}
          </div>
        </div>
      )}

      {!loading &&
        view === "list" &&
        grouped.map(([key, dayEvents], di) => {
          const limit = shown[key] ?? PAGE;
          const more = dayEvents.length - limit;
          const shownEvents = dayEvents.slice(0, limit);
          const colors = posterColors(shownEvents);
          return (
            <div key={key} id={`day-${key}`} className="mb-8 scroll-mt-14">
              <div className="sticky top-14 z-10 -mx-4 flex items-center justify-between gap-3 bg-[#2b2119]/95 px-4 py-2 backdrop-blur">
                <h2 className="flex min-w-0 items-baseline gap-2">
                  <span className="font-poster truncate text-[28px] uppercase leading-none" style={{ color: PAPER[di % PAPER.length] }}>
                    {formatDayLabel(startedBefore(dayEvents[0]) ? new Date().toISOString() : dayEvents[0].starts_at)}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-white/70">{dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}</span>
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                {dayEvents.length > PAGE && (
                  <div className="inline-flex shrink-0 rounded-full border border-white/10 bg-white/5 p-0.5 text-[11px] font-medium" aria-label="How many to show">
                    {[["Top 25", PAGE], ["50", PAGE * 2], ["All", Infinity]].filter(([, n]) => n === Infinity || n === PAGE || (n as number) < dayEvents.length).map(([label, n]) => {
                      const on = n === Infinity ? limit >= dayEvents.length : limit === n;
                      return (
                        <button key={label} onClick={() => showDay(key, n as number)}
                          className={`rounded-full px-2.5 py-0.5 transition ${on ? "bg-white text-black" : "text-white/60 hover:text-white"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                  <button
                    onClick={() => setSheetOpen(true)}
                    aria-label="Change place or event type"
                    className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                    {filter !== "all" && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#ffe45c]" />}
                  </button>
                  <button
                    onClick={() => openMap(key)}
                    aria-label="See this day on the map"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
                      <path d="M9 4v14M15 6v14" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flyer-stack mt-2">
                {shownEvents.map((ev, i) => (
                  <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} paper={colors[i]} />
                ))}
              </div>
              {more > 0 && (
                <button
                  onClick={() => showDay(key, limit >= PAGE * 3 ? Infinity : limit + PAGE)}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/70 hover:bg-white/[0.06]"
                >
                  {limit >= PAGE * 3 ? `Show all ${dayEvents.length}` : `View ${Math.min(PAGE, more)} more`}
                  <span className="text-white/40"> · {more} not shown</span>
                </button>
              )}
            </div>
          );
        })}

      {!loading && view === "list" && grouped.length > 0 && (
        <p className="-mt-4 mb-6 text-[11px] text-white/30">
          Street maps ©{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60">
            OpenStreetMap
          </a>{" "}
          contributors · OpenMapTiles ·{" "}
          <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer" className="underline hover:text-white/60">
            OpenFreeMap
          </a>
        </p>
      )}

          {/* One unobtrusive house ad for mobile (rail is hidden there) */}
          {loc && visible.length > 0 && (
            <div className="mt-6 lg:hidden">
              <AdUnit index={0} area={area} className="min-h-[140px]" />
            </div>
          )}
        </div>

        <AdRail area={area} />
      </div>

      {sheetOpen && loc && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={() => setSheetOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Change place or event type"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-lg space-y-5 overflow-y-auto rounded-t-3xl border border-white/10 bg-[#2b2119] p-5 pb-8 sm:rounded-3xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">Where</h2>
              <button onClick={() => setSheetOpen(false)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white">
                ✕
              </button>
            </div>
            {searchForm}
            <div className="text-center">
              <button onClick={useMyLocation} className="text-sm text-white/50 underline-offset-4 hover:text-white/80 hover:underline">
                or use my current location
              </button>
            </div>
            {areaChips}
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">What</h2>
            {typeChips(true)}
          </div>
        </div>
      )}
    </main>
  );
}

/** Started on an earlier day and still running (shown under today, with its end date). */
function startedBefore(ev: NearbyEvent) {
  return dayKey(ev.starts_at) < dayKey(new Date().toISOString());
}

/** The day an event is listed under (a run that started earlier sits under today). */
function eventDay(ev: NearbyEvent) {
  return dayKey(startedBefore(ev) ? new Date().toISOString() : ev.starts_at);
}

const todayKey = () => dayKey(new Date().toISOString());
// Noon in LA for a YYYY-MM-DD key, so formatting never slips a day.
const dayIso = (key: string) => `${key}T20:00:00Z`;
function shiftDay(key: string, n: number) {
  const d = new Date(dayIso(key));
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d.toISOString());
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(dayIso(b)) - Date.parse(dayIso(a))) / 86400000);
const monthDay = (key: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(dayIso(key)));

const placeName = (l: Loc) => (l.label === "your location" ? "you" : l.label);

// Day-glo poster stock (Colby-style); each event keeps the same color and tilt on every visit.
const PAPER = ["#fff23a", "#ff5fae", "#86f45c", "#ff9a3c", "#62d8ff"];
const hashId = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};
function flyerLook(id: string, paper?: string): React.CSSProperties {
  const h = hashId(id);
  return { "--paper": paper ?? PAPER[h % PAPER.length], "--tilt": `${((h >> 3) % 5 - 2) * 0.3}deg` } as React.CSSProperties;
}
/** Each event's color, nudged to the next one when it would match the poster it overlaps. */
function posterColors(evs: NearbyEvent[]): string[] {
  const out: string[] = [];
  for (const ev of evs) {
    let i = hashId(ev.event_id) % PAPER.length;
    if (PAPER[i] === out[out.length - 1]) i = (i + 1) % PAPER.length;
    out.push(PAPER[i]);
  }
  return out;
}

function EventCard({ ev, feedback, featured, paper }: { ev: NearbyEvent; feedback: boolean; featured?: LiveCampaign; paper?: string }) {
  const cat = categoryMeta(ev.category);
  const seenRef = useSeen(featured?.id ?? null);
  // Views and taps feed the traffic ranking (counts only).
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => (cardEl ? observeEventView(cardEl, ev.event_id) : undefined), [cardEl, ev.event_id]);
  const cardRef = useCallback((el: HTMLDivElement | null) => { setCardEl(el); if (featured) seenRef(el); }, [featured, seenRef]);
  const onTap = () => countClick(ev.event_id);
  const look = flyerLook(ev.event_id, paper);
  const more = ev.occurrence_count_remaining ?? 0;
  const body = (
    <div ref={cardRef} className="flyer flex gap-3 px-4 pb-6 pt-6 sm:gap-4" style={look}>
      <div className="flex w-[104px] shrink-0 flex-col gap-2 sm:w-32">
        {/* Inked block with the poster's color knocked out, like a letterpress date line. */}
        <time
          dateTime={ev.starts_at}
          className="font-poster rounded-sm bg-[#111] px-1 py-1.5 text-center leading-none"
          style={{ color: "var(--paper)" }}
        >
          {startedBefore(ev) && ev.ends_at ? (
            <>
              <span className="block text-[13px] uppercase">Until</span>
              <span className="block text-[21px] uppercase">{monthDay(dayKey(ev.ends_at))}</span>
            </>
          ) : (
            <>
              <span className="block text-[23px]">{formatTime(ev.starts_at)}</span>
              {more > 0 && <span className="mt-1 block text-[13px]">+{more} more time{more === 1 ? "" : "s"}</span>}
            </>
          )}
        </time>
        <VenueMiniMap lat={ev.venue_lat} lng={ev.venue_lng} venue={ev.venue_name} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="inline-block rounded-full border-2 border-[#111] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#111]">
          {cat.emoji} {cat.label}
        </span>
        <h3 className={`font-poster mt-1.5 text-[26px] leading-[1.03] text-[#111] sm:text-[30px] ${ev.cancelled ? "line-through opacity-60" : ""}`}>
          {ev.title}
        </h3>
        {featured && (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[11px] font-medium text-fuchsia-300 ring-1 ring-fuchsia-500/30">
              Featured
            </span>
            {/* Pinned above the day list, so say which day. */}
            <span className="text-[11px] text-black/60">{formatDayLabel(ev.starts_at)}</span>
            <span className="text-[10px] uppercase tracking-widest text-black/55">Sponsored</span>
            <WhySponsored className="" />
          </div>
        )}
        <p className="mt-1 text-[15px] font-bold leading-snug text-[#111]">
          {ev.venue_name} · {formatDistance(ev.distance_km)} away
          {ev.price ? ` · ${ev.price_is_usual ? "usually " : ""}${ev.price}` : ""}
        </p>
        {ev.last_occurrence_date && (
          <p className="mt-0.5 text-sm font-extrabold uppercase tracking-wide text-[#111]">
            Until {formatShortDate(ev.last_occurrence_date)}
          </p>
        )}
        {(ev.venue_parking || ev.venue_good_to_know) && (
          <p className="mt-0.5 text-sm font-medium text-black/80">
            {ev.venue_parking ? `🅿️ ${ev.venue_parking}` : ""}
            {ev.venue_parking && ev.venue_good_to_know ? " · " : ""}
            {ev.venue_good_to_know ? `ℹ️ ${ev.venue_good_to_know}` : ""}
          </p>
        )}
        {(ev.cancelled || !!ev.uncertain_fields?.length) && (
          <div className="mt-1.5 flex flex-wrap gap-1"><UnconfirmedBadges ev={ev} /></div>
        )}
        {ev.description && (
          <p className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug text-black/85">{ev.description}</p>
        )}
        {ev.tags && ev.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ev.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full border-[1.5px] border-[#111]/70 px-2 py-0.5 text-xs font-bold text-[#111]">
                {t}
              </span>
            ))}
          </div>
        )}
        {ev.is_recurring && ev.recurrence_description && (
          <p className="mt-1.5 text-sm font-semibold text-black/80">🔁 {ev.recurrence_description}</p>
        )}
        <EventFeedback ev={ev} enabled={feedback} lead={<GoingButton ev={ev} compact />} />
      </div>
    </div>
  );

  // A featured event links through /go/<campaign> (counts a click, then the campaign's link).
  if (featured) {
    return (
      <a href={`/go/${featured.id}`} target="_blank" rel="sponsored noopener" className="block" onClick={onTap}>
        {body}
      </a>
    );
  }

  return ev.url ? (
    <a href={ev.url} target="_blank" rel="noopener noreferrer" className="block" onClick={onTap}>
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
