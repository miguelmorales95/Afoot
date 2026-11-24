"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { NearbyEvent } from "@/lib/types";
import {
  briefWords,
  formatTag,
  parkingStatus,
  scheduleLine,
  categoryMeta,
  dayKey,
  formatDayLabel,
  formatDistance,
  formatTime,
} from "@/lib/format";
import AdRail from "@/components/AdRail";
import GoingButton from "@/components/GoingButton";
import EventFeedback, { UnconfirmedBadges } from "@/components/EventFeedback";
import VenueMiniMap from "@/components/VenueMiniMap";
import VenueMapModal from "@/components/VenueMapModal";
import DateRangePicker from "@/components/DateRangePicker";
import PlaceSearch, { type PlacePick } from "@/components/PlaceSearch";
import { FEED_NOTES, FeedNote } from "@/components/FeedNotes";
import { NEWSLETTER_EVENT } from "@/components/SiteHeader";
import WeeklyEmailSheet from "@/components/WeeklyEmailSheet";
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
  /** The whole region, not one spot: a wide radius and no "mi away". */
  all?: boolean;
}

const ALL_LA: Loc = { lat: 34.05, lng: -118.25, label: "All of LA", all: true };

const STORAGE_KEY = "afoot_loc";
const LAYOUT_KEY = "afoot_layout";
const PAGE = 15;
// A note (ad or ask) goes before card NOTE_FIRST of each day (0-based), then every NOTE_EVERY cards.
const NOTE_FIRST = 5;
const NOTE_EVERY = 12;
// Days of the list drawn at first, and how many more each time the reader scrolls near the end.
const DAYS_FIRST = 3;
const DAYS_MORE = 4;

// Nothing picked means everything. "Games" covers game nights and trivia (each was too thin alone).
const FILTERS: { key: string; label: string }[] = [
  { key: "music", label: "🎸 Music" },
  { key: "comedy", label: "🎭 Comedy" },
  { key: "class", label: "✏️ Classes" },
  { key: "art", label: "🎨 Art" },
  { key: "games", label: "🧠 Games" },
  { key: "market", label: "🛍️ Markets" },
  { key: "food", label: "🍽️ Food" },
];
const filterKey = (category: string | null) => (category === "trivia" ? "games" : category ?? "other");


export default function Home() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [events, setEvents] = useState<NearbyEvent[]>([]);
  const [feedback, setFeedback] = useState(false); // flags/checks need the database
  // Event types shown; empty means everything. The chips follow `types` right away; the feed
  // follows the deferred copy, so a tap lights or clears its chip before the list re-renders.
  const [types, setTypes] = useState<Set<string>>(new Set());
  const shownTypes = useDeferredValue(types);
  const filtering = shownTypes !== types;
  const [view, setView] = useState<View>("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroOpen, setHeroOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mapRange, setMapRange] = useState<{ start: string; end: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The weekly-email sheet: opened by the envelope in the site header (or /?newsletter=1 from
  // other pages); the confirm / unsubscribe links come back with ?newsletter=confirmed|stopped|expired.
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailNote, setEmailNote] = useState<string | null>(null);
  useEffect(() => {
    const open = () => setEmailOpen(true);
    window.addEventListener(NEWSLETTER_EVENT, open);
    const q = new URLSearchParams(window.location.search).get("newsletter");
    if (q === "1") setEmailOpen(true);
    else if (q) setEmailNote(
      q === "confirmed" ? "You're on the list. The first email comes Thursday morning."
      : q === "stopped" ? "Done. No more weekly emails."
      : "That link didn't work. Try signing up again from the ✉ button.",
    );
    if (q) window.history.replaceState(null, "", window.location.pathname);
    return () => window.removeEventListener(NEWSLETTER_EVENT, open);
  }, []);
  // Big posters (default) or the compact layout; remembered on this device.
  const [compact, setCompact] = useState(false);
  useEffect(() => { try { setCompact(localStorage.getItem(LAYOUT_KEY) === "compact"); } catch { /* ignore */ } }, []);
  const toggleLayout = () =>
    setCompact((c) => {
      try { localStorage.setItem(LAYOUT_KEY, c ? "posters" : "compact"); } catch { /* ignore */ }
      return !c;
    });
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
      const start = saved ? (JSON.parse(saved) as Loc) : ALL_LA;
      setLoc(start);
      // First visit: show everything, with the search still open to narrow it down.
      if (!saved) setHeroOpen(true);
      void loadEvents(start);
    } catch {
      setLoc(ALL_LA);
      setHeroOpen(true);
      void loadEvents(ALL_LA);
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
      const res = await fetch(`/api/events?lat=${l.lat}&lng=${l.lng}&radius=${l.all ? 80 : 25}&days=45`);
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

  const goTo = async (pick: PlacePick) => {
    if (pick.kind === "all") { persist(ALL_LA); void loadEvents(ALL_LA); return; }
    if (pick.kind === "place") {
      const l: Loc = { lat: pick.place.lat, lng: pick.place.lng, label: pick.place.name };
      persist(l);
      void loadEvents(l);
      return;
    }
    // A ZIP, or a place not in the suggestions: geocode it.
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(pick.text)}`);
      const data = await res.json();
      if (!res.ok) throw new Error("Couldn't find that place. Try a city, neighborhood, or ZIP.");
      const l: Loc = { lat: data.lat, lng: data.lng, label: /^\d{5}$/.test(pick.text) ? pick.text : shortLabel(data.label, pick.text) };
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
    () => (shownTypes.size === 0 ? events : events.filter((e) => shownTypes.has(filterKey(e.category)))),
    [events, shownTypes],
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

  // Each day shows its top 15; the button adds 15, then 15 more, then shows the rest.
  const [shown, setShown] = useState<Record<string, number>>({});
  // Lineup cards (several shows at one venue that day) the reader has opened into their own cards.
  const [openLineups, setOpenLineups] = useState<Set<string>>(new Set());

  // The day whose header is pinned at the top (or the first day): it alone shows filter + map.
  const [currentDay, setCurrentDay] = useState<string | null>(null);
  useEffect(() => {
    if (view !== "list" || !grouped.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const PINNED = 56 + 8; // site header height, plus a little
      let day = grouped[0][0];
      for (const [key] of grouped) {
        const el = document.getElementById(`day-${key}`);
        if (el && el.getBoundingClientRect().top <= PINNED) day = key;
        else break;
      }
      setCurrentDay((d) => (d === day ? d : day));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [view, grouped]);
  // Each day's cards (lineups grouped), kept stable so the memoized cards skip re-rendering.
  const dayItems = useMemo(() => new Map(grouped.map(([k, evs]) => [k, lineupItems(evs)])), [grouped]);
  // Ads and asks between the posters: one after the 5th card of each day, then every 12 cards,
  // cycling through FEED_NOTES down the whole feed.
  const noteStarts = useMemo(() => {
    const out: Record<string, number> = {};
    let n = 0;
    for (const [k] of grouped) { out[k] = n; n += Math.ceil(Math.max(0, (dayItems.get(k)?.length ?? 0) - NOTE_FIRST) / NOTE_EVERY); }
    return out;
  }, [grouped, dayItems]);
  const toggleLineup = useCallback((id: string) =>
    setOpenLineups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    }), []);
  // Days drawn so far: a few at first, more as the reader nears the end (all 45 days at once
  // was ~700 posters, which made every filter tap slow).
  // Reset during render (not in an effect), so a new list never first draws with the old,
  // longer limit: a filtered list is short, so the limit grows fast while a filter is on.
  const [dayLimit, setDayLimit] = useState(DAYS_FIRST);
  const [feedOf, setFeedOf] = useState({ events, shownTypes });
  if (feedOf.events !== events || feedOf.shownTypes !== shownTypes) {
    setFeedOf({ events, shownTypes });
    setShown({});
    setDayLimit(DAYS_FIRST);
  }
  const moreDaysRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setDayLimit((d) => d + DAYS_MORE),
      { rootMargin: "1500px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const scrollToControls = () =>
    requestAnimationFrame(() => controlsRef.current?.scrollIntoView({ block: "start" }));

  const openMap = (day?: string) => {
    const d = day ?? todayKey();
    setMapRange({ start: d, end: d });
    setPickerOpen(false);
    setView("map");
    scrollToControls();
  };

  // Types combine ("Comedy" + "Music"); tapping a picked one again unpicks it.
  const pickFilter = (key: string) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const closeSheet = () => {
    setSheetOpen(false);
    scrollToControls();
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

  const searchForm = <PlaceSearch onPick={(p) => void goTo(p)} current={loc && !loc.all ? placeName(loc) : undefined} />;

  const typeChips = (fromSheet: boolean) => (
    <div className={`flex flex-wrap gap-1.5 ${fromSheet ? "justify-center" : ""}`} aria-label="Event types">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => pickFilter(f.key)}
          aria-pressed={types.has(f.key)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            types.has(f.key) ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"
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

      {emailNote && (
        <p className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-[#ffe45c]/30 bg-[#ffe45c]/10 px-4 py-3 text-sm text-[#fff3a6]">
          {emailNote}
          <button onClick={() => setEmailNote(null)} aria-label="Dismiss" className="text-[#fff3a6]/70 hover:text-[#fff3a6]">✕</button>
        </p>
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
                <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} featured={campaign} paper={colors[i]} wide={!!loc?.all} compact={compact} />
              ));
            })()}
          </div>
        </div>
      )}

      {!loading &&
        view === "list" &&
        grouped.slice(0, dayLimit).map(([key, dayEvents], di) => {
          const items = dayItems.get(key) ?? [];
          const limit = shown[key] ?? PAGE;
          const hidden = items.length - limit;
          const colors = posterColors(items.slice(0, limit).map((it) => (it.kind === "one" ? it.ev : it.evs[0])));
          return (
            <div key={key} id={`day-${key}`} className="mb-8 scroll-mt-14">
              <div className="sticky top-14 z-10 -mx-4 flex items-center justify-between gap-3 bg-[#2b2119]/95 px-4 py-2 backdrop-blur">
                <h2 className="flex min-w-0 items-baseline gap-2">
                  <span className="font-poster truncate text-[28px] uppercase leading-none" style={{ color: PAPER[di % PAPER.length] }}>
                    {formatDayLabel(startedBefore(dayEvents[0]) ? new Date().toISOString() : dayEvents[0].starts_at)}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-white/70">{dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}</span>
                </h2>
                {/* One filter + map pair on the page: on the day header pinned at the top. */}
                {key === currentDay && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={toggleLayout}
                    aria-pressed={compact}
                    aria-label={compact ? "Show big posters" : "Show compact list"}
                    title={compact ? "Big posters" : "Compact"}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    {compact ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                        <rect x="4" y="3" width="16" height="8" rx="1" /><rect x="4" y="13" width="16" height="8" rx="1" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                        <rect x="4" y="3" width="16" height="4" rx="1" /><rect x="4" y="10" width="16" height="4" rx="1" /><rect x="4" y="17" width="16" height="4" rx="1" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => setSheetOpen(true)}
                    aria-label="Change place or event type"
                    className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M4 6h16M7 12h10M10 18h4" />
                    </svg>
                    {types.size > 0 && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[#ffe45c]" />}
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
                )}
              </div>
              <div className={`flyer-stack mt-2 transition-opacity ${filtering ? "opacity-60" : ""}`}>
                {items.slice(0, limit).flatMap((it, i) => {
                  const slot = i - NOTE_FIRST;
                  const note = slot >= 0 && slot % NOTE_EVERY === 0
                    ? (() => { const n = noteStarts[key] + slot / NOTE_EVERY; return [<FeedNote key={`note-${key}-${i}`} kind={FEED_NOTES[n % FEED_NOTES.length]} n={Math.floor(n / FEED_NOTES.length)} area={area} />]; })()
                    : [];
                  if (it.kind === "one") return [...note, <EventCard key={it.ev.occurrence_id} ev={it.ev} feedback={feedback} paper={colors[i]} wide={!!loc?.all} compact={compact} />];
                  const id = `${key}|${it.key}`;
                  const open = openLineups.has(id);
                  return [
                    ...note,
                    <LineupCard key={id} id={id} evs={it.evs} paper={colors[i]} wide={!!loc?.all} open={open} onToggle={toggleLineup} compact={compact} />,
                    ...(open
                      // Same paper as the lineup card, so the opened shows read as one stack.
                      ? it.evs.map((ev) => (
                          <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} paper={colors[i]} wide={!!loc?.all} inLineup compact={compact} />
                        ))
                      : []),
                  ];
                })}
              </div>
              {hidden > 0 && (
                <button
                  onClick={() => setShown((s) => ({ ...s, [key]: limit >= PAGE * 3 ? Infinity : limit + PAGE }))}
                  className="mt-4 w-full rounded-full border-2 border-white/20 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white/85 hover:border-white/40 hover:text-white"
                >
                  {limit >= PAGE * 3 ? `Show all ${items.length}` : `Show ${Math.min(PAGE, hidden)} more`}
                  <span className="ml-2 font-bold normal-case tracking-normal text-white/45">{hidden} not shown</span>
                </button>
              )}
            </div>
          );
        })}

      {!loading && view === "list" && dayLimit < grouped.length && (
        // Re-keyed per step so the observer fires again once more days are drawn.
        <div key={dayLimit} ref={moreDaysRef} className="h-px" aria-hidden />
      )}

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

        </div>

        <AdRail area={area} />
      </div>

      {emailOpen && (
        <WeeklyEmailSheet
          loc={loc ?? ALL_LA}
          placeName={placeName(loc ?? ALL_LA)}
          types={[...types]}
          onClose={() => setEmailOpen(false)}
          onChangeFilters={() => { setEmailOpen(false); setSheetOpen(true); }}
        />
      )}

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
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/50">What</h2>
            {typeChips(true)}
            <button
              onClick={closeSheet}
              className="w-full rounded-full bg-[#fff23a] px-5 py-3 text-sm font-extrabold text-[#111] hover:bg-[#fff58a]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** The source gave no start time (the stored time is a placeholder). */
const timeTba = (ev: NearbyEvent) => !!ev.uncertain_fields?.includes("starts_at");

/** Started on an earlier day and still running (shown under today, with its end date). */
function startedBefore(ev: NearbyEvent) {
  return dayKey(ev.starts_at) < todayKey();
}

/** The day an event is listed under (a run that started earlier sits under today). */
function eventDay(ev: NearbyEvent) {
  return dayKey(startedBefore(ev) ? new Date().toISOString() : ev.starts_at);
}

// Today's key, worked out at most once a minute (it's checked for every event).
let today = { at: 0, key: "" };
function todayKey() {
  const now = Date.now();
  if (now - today.at > 60_000) today = { at: now, key: dayKey(new Date(now).toISOString()) };
  return today.key;
}
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

const placeName = (l: Loc) => (l.all ? "LA" : l.label === "your location" ? "you" : l.label);

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

/** `wide`: browsing all of LA, where distance from downtown means nothing, so it's left off. */
// Memoized: a filter tap re-renders the page, and the cards whose props didn't change skip it.
/** `compact`: the tighter layout. Same poster and bold type, minus the type badge, map, gist,
 *  description and tags (parking stays). */
const EventCard = memo(function EventCard({ ev, feedback, featured, paper, wide, inLineup, compact }: { ev: NearbyEvent; feedback: boolean; featured?: LiveCampaign; paper?: string; wide?: boolean; inLineup?: boolean; compact?: boolean }) {
  const cat = categoryMeta(ev.category);
  const seenRef = useSeen(featured?.id ?? null);
  // Views and taps feed the traffic ranking (counts only).
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => (cardEl ? observeEventView(cardEl, ev.event_id) : undefined), [cardEl, ev.event_id]);
  const cardRef = useCallback((el: HTMLDivElement | null) => { setCardEl(el); if (featured) seenRef(el); }, [featured, seenRef]);
  const onTap = () => countClick(ev.event_id);
  const look = flyerLook(ev.event_id, paper);
  const more = ev.occurrence_count_remaining ?? 0;
  const keywords = useMemo(() => briefWords(ev), [ev]);
  const parking = parkingStatus(ev);
  // A run that started earlier already says "Until …" in the time block.
  const schedule = scheduleLine(ev, !(startedBefore(ev) && ev.ends_at));
  const [mapOpen, setMapOpen] = useState(false);
  const closeMap = useCallback(() => setMapOpen(false), []);
  const venueLine = [
    ...(inLineup ? [] : [ev.venue_name, ...(wide ? [] : [`${formatDistance(ev.distance_km)} away`])]),
    ...(ev.price ? [`${ev.price_is_usual ? "usually " : ""}${ev.price}`] : []),
  ].join(" · ");
  const body = (
    <div ref={cardRef} className={`flyer flex gap-3 px-4 sm:gap-4 ${compact ? "pb-4 pt-5" : "pb-6 pt-6"}`} style={look}>
      <div className={`flex shrink-0 flex-col gap-2 ${compact ? "w-[100px] sm:w-28" : "w-[104px] sm:w-32"}`}>
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
              <span className="block text-[23px]">{timeTba(ev) ? "TIME TBA" : formatTime(ev.starts_at)}</span>
              {more > 0 && <span className="mt-1 block text-[13px]">+{more} more time{more === 1 ? "" : "s"}</span>}
            </>
          )}
        </time>
        {schedule && (
          <p className="text-center text-[13px] font-extrabold uppercase leading-tight tracking-wide text-[#111]">{schedule}</p>
        )}
        {/* Under a lineup card the venue, map and type are already shown once above. */}
        {!inLineup && !compact && (
          <button
            type="button"
            aria-label={`Bigger map of ${ev.venue_name}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMapOpen(true); }}
            className="block w-full cursor-zoom-in"
          >
            <VenueMiniMap lat={ev.venue_lat} lng={ev.venue_lng} venue={ev.venue_name} />
          </button>
        )}
        {mapOpen && <VenueMapModal ev={ev} onClose={closeMap} />}
      </div>
      <div className="min-w-0 flex-1">
        {!inLineup && !compact && (
          <span className="inline-block rounded-full border-2 border-[#111] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#111]">
            {cat.emoji} {cat.label}
          </span>
        )}
        <h3 className={`font-poster leading-[1.03] text-[#111] ${compact ? "text-[24px] sm:text-[27px]" : "mt-1.5 text-[26px] sm:text-[30px]"} ${ev.cancelled ? "line-through opacity-60" : ""}`}>
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
        {venueLine && <p className="mt-1 text-[15px] font-bold leading-snug text-[#111]">{venueLine}</p>}
        {ev.venue_good_to_know && (
          <p className="mt-0.5 text-sm font-medium text-black/80">ℹ️ {ev.venue_good_to_know}</p>
        )}
        {(ev.cancelled || !!ev.uncertain_fields?.length) && (
          <div className="mt-1.5 flex flex-wrap gap-1"><UnconfirmedBadges ev={ev} /></div>
        )}
        {ev.voice_line && !compact && <VoiceLine line={ev.voice_line} />}
        {ev.description && !ev.voice_line && !compact && (
          <div className="hidden sm:block">
            <p className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-snug text-black/85">{ev.description}</p>
          </div>
        )}
        {/* Phones: keywords pulled from the listing, set like a poster's small print, and labeled
            as what they are: an auto-pulled gist, not a write-up. */}
        {keywords.length > 0 && !ev.voice_line && !compact && <GistLine words={keywords} />}
        {((!!ev.tags?.length && !compact) || parking) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {/* Only when we know; otherwise assume street parking. */}
            {parking && (
              <span
                title={ev.venue_parking ?? (parking === "no-parking" ? "Visitors say it's hard to park" : undefined)}
                className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                  parking === "parking" ? "bg-[#111] text-[var(--paper)]" : "border-[1.5px] border-dashed border-[#111] text-[#111]"
                }`}
              >
                {parking === "parking" ? "🅿️ Parking" : "No Parking"}
              </span>
            )}
            {(compact ? [] : ev.tags ?? []).slice(0, 4).map((t) => (
              <span key={t} className="rounded-full border-[1.5px] border-[#111]/70 px-2 py-0.5 text-xs font-bold text-[#111]">
                {formatTag(t)}
              </span>
            ))}
          </div>
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
});

/** The card's line in Miguel's voice, with the same stamp, and an honest note when tapped. */
function VoiceLine({ line }: { line: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <p className="text-[15px] font-bold leading-snug text-black/90">
        <button
          type="button"
          aria-expanded={open}
          aria-label="Who wrote this?"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-black/60 px-1 align-[2px] text-[10px] font-extrabold uppercase leading-[14px] tracking-[0.12em] text-black/70"
        >
          Gist
        </button>
        {line}
      </p>
      {open && (
        <p className="mt-1 text-[12px] font-semibold leading-snug text-black/70">
          A robot wrote this from the event&apos;s listing, trying to sound like Miguel. It&apos;s the gist, not a review: Light Pole is one dude covering all of LA, so tap through for the details.
        </p>
      )}
    </div>
  );
}

/** The auto-pulled keywords, with a "GIST" stamp that says, when tapped, where they came from. */
function GistLine({ words }: { words: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5 sm:hidden">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-extrabold uppercase leading-snug tracking-[0.08em] text-black/85">
        <button
          type="button"
          aria-expanded={open}
          aria-label="What are these words?"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
          className="rounded-[3px] border-[1.5px] border-black/60 px-1 text-[10px] leading-[14px] tracking-[0.12em] text-black/70"
        >
          Gist
        </button>
        {words.map((w, i) => (
          <span key={w}>
            {w}
            {i < words.length - 1 && <span aria-hidden className="ml-1.5 opacity-40">·</span>}
          </span>
        ))}
      </p>
      {open && (
        <p className="mt-1 text-[12px] font-semibold normal-case leading-snug tracking-normal text-black/70">
          Words a robot pulled from the event&apos;s listing. It&apos;s the gist, not a review: Light Pole is one dude covering all of LA.
        </p>
      )}
    </div>
  );
}

type DayItem = { kind: "one"; ev: NearbyEvent } | { kind: "lineup"; key: string; evs: NearbyEvent[] };

/**
 * A day's cards: events of the same type at the same venue (four comedy shows at one club) become
 * one lineup card, placed where the venue's best-ranked show would be. Runs that started earlier
 * ("Until Dec 24") stay on their own.
 */
function lineupItems(evs: NearbyEvent[]): DayItem[] {
  const groupKey = (ev: NearbyEvent) => (startedBefore(ev) ? `solo:${ev.occurrence_id}` : `${ev.venue_id}|${ev.category ?? "other"}`);
  const groups = new Map<string, NearbyEvent[]>();
  for (const ev of evs) (groups.get(groupKey(ev)) ?? groups.set(groupKey(ev), []).get(groupKey(ev))!).push(ev);
  const out: DayItem[] = [];
  const placed = new Set<string>();
  for (const ev of evs) {
    const k = groupKey(ev);
    if (placed.has(k)) continue;
    placed.add(k);
    const g = groups.get(k)!;
    out.push(g.length >= 2 ? { kind: "lineup", key: k, evs: [...g].sort((a, b) => a.starts_at.localeCompare(b.starts_at)) } : { kind: "one", ev });
  }
  return out;
}

/** Several shows at one venue that day, set like a club's flyer: venue on top, then the lineup. */
const LineupCard = memo(function LineupCard({ id, evs, paper, wide, open, onToggle, compact }: { id: string; evs: NearbyEvent[]; paper?: string; wide?: boolean; open: boolean; onToggle: (id: string) => void; compact?: boolean }) {
  const first = evs[0];
  const cat = categoryMeta(first.category);
  const parking = parkingStatus(first);
  const [mapOpen, setMapOpen] = useState(false);
  const closeMap = useCallback(() => setMapOpen(false), []);
  const SHOWN = 6;
  return (
    <div className={`flyer flex gap-3 px-4 sm:gap-4 ${compact ? "pb-4 pt-5" : "pb-6 pt-6"}`} style={flyerLook(first.venue_id, paper)}>
      <div className={`flex shrink-0 flex-col gap-2 ${compact ? "w-[100px] sm:w-28" : "w-[104px] sm:w-32"}`}>
        <div className="font-poster rounded-sm bg-[#111] px-1 py-1.5 text-center leading-none" style={{ color: "var(--paper)" }}>
          <span className="block text-[23px] uppercase">{evs.length} shows</span>
          {!timeTba(first) && <span className="mt-1 block text-[13px]">from {formatTime(first.starts_at)}</span>}
        </div>
        {!compact && (
          <button
            type="button"
            aria-label={`Bigger map of ${first.venue_name}`}
            onClick={() => setMapOpen(true)}
            className="block w-full cursor-zoom-in"
          >
            <VenueMiniMap lat={first.venue_lat} lng={first.venue_lng} venue={first.venue_name} />
          </button>
        )}
        {mapOpen && <VenueMapModal ev={first} onClose={closeMap} />}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <span className="inline-block rounded-full border-2 border-[#111] px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-[#111]">
            {cat.emoji} {cat.label}
          </span>
        )}
        <h3 className={`font-poster leading-[1.03] text-[#111] ${compact ? "text-[24px] sm:text-[27px]" : "mt-1.5 text-[26px] sm:text-[30px]"}`}>{first.venue_name}</h3>
        {!wide && <p className="mt-1 text-[15px] font-bold text-[#111]">{formatDistance(first.distance_km)} away</p>}
        <ul className="mt-2 space-y-1">
          {evs.slice(0, SHOWN).map((ev) => (
            <li key={ev.occurrence_id} className="flex gap-2 text-[15px] font-bold leading-snug text-[#111]">
              <span className="font-poster w-[62px] shrink-0 text-[16px]">{timeTba(ev) ? "TBA" : formatTime(ev.starts_at)}</span>
              {ev.url ? (
                <a href={ev.url} target="_blank" rel="noopener noreferrer" onClick={() => countClick(ev.event_id)} className={`min-w-0 underline-offset-2 hover:underline ${ev.cancelled ? "line-through opacity-60" : ""}`}>
                  {ev.title}
                </a>
              ) : (
                <span className={`min-w-0 ${ev.cancelled ? "line-through opacity-60" : ""}`}>{ev.title}</span>
              )}
            </li>
          ))}
          {evs.length > SHOWN && <li className="text-sm font-extrabold text-black/70">+{evs.length - SHOWN} more</li>}
        </ul>
        {parking && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${parking === "parking" ? "bg-[#111] text-[var(--paper)]" : "border-[1.5px] border-dashed border-[#111] text-[#111]"}`}>
              {parking === "parking" ? "🅿️ Parking" : "No Parking"}
            </span>
          </div>
        )}
        <button type="button" onClick={() => onToggle(id)} aria-expanded={open} className="going-btn mt-3 rounded-full">
          {open ? "Show less" : "See all"}
        </button>
      </div>
    </div>
  );
});

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
