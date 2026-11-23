"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import EventsTable from "@/components/EventsTable";
import GoingButton from "@/components/GoingButton";
import EventFeedback, { UnconfirmedBadges } from "@/components/EventFeedback";
import VenueMiniMap from "@/components/VenueMiniMap";
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
      const k = dayKey(startedBefore(ev) ? new Date().toISOString() : ev.starts_at);
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

  return (
    <main className="mx-auto max-w-6xl px-4">
      {/* Hero / search */}
      <section className="hero-glow -mx-4 px-4 pt-10 pb-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            What&apos;s posted around LA.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-white/60">
            Shows, markets, game nights, open mics and the small stuff that never makes the big
            ticketing sites, all on one pole. No login, just your corner of LA.
          </p>

          <form onSubmit={search} className="mx-auto mt-6 flex max-w-lg flex-col gap-2 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Neighborhood, city, or ZIP (e.g. Echo Park)"
              className="flex-1 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm outline-none placeholder:text-white/30 focus:border-[#ffe45c]/60"
            />
            <button
              type="submit"
              className="rounded-full bg-[#ffe45c] px-5 py-3 text-sm font-semibold text-[#1a1a1a] hover:bg-[#fff08a]"
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
          <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-1.5" aria-label="Neighborhoods">
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

      {!loading && view === "list" && featured.length > 0 && (
        <div className="mb-8">
          <h2 className="py-2 text-sm font-semibold uppercase tracking-wider text-white/40">Featured</h2>
          <div className="mt-2 space-y-3">
            {featured.map(({ ev, campaign }) => (
              <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} featured={campaign} />
            ))}
          </div>
        </div>
      )}

      {!loading &&
        view === "list" &&
        grouped.map(([key, dayEvents]) => {
          const limit = shown[key] ?? PAGE;
          const more = dayEvents.length - limit;
          return (
            <div key={key} id={`day-${key}`} className="mb-8 scroll-mt-14">
              <div className="sticky top-14 z-10 -mx-4 flex items-center justify-between gap-3 bg-[#2b2119]/90 px-4 py-2 backdrop-blur">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40">
                  {formatDayLabel(startedBefore(dayEvents[0]) ? new Date().toISOString() : dayEvents[0].starts_at)}
                  <span className="ml-2 normal-case tracking-normal text-white/25">{dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}</span>
                </h2>
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
              </div>
              <div className="mt-2 space-y-3">
                {dayEvents.slice(0, limit).map((ev) => (
                  <EventCard key={ev.occurrence_id} ev={ev} feedback={feedback} />
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
    </main>
  );
}

/** Started on an earlier day and still running (shown under today, with its end date). */
function startedBefore(ev: NearbyEvent) {
  return dayKey(ev.starts_at) < dayKey(new Date().toISOString());
}

// Street-flyer paper colors; each event keeps the same color and tilt on every visit.
const PAPER = ["#ffe45c", "#ff9ec0", "#8ed8f8", "#b9ef9b", "#ffbf73", "#fffdf7"];
function flyerLook(id: string): React.CSSProperties {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { "--paper": PAPER[h % PAPER.length], "--tilt": `${((h >> 3) % 5 - 2) * 0.35}deg` } as React.CSSProperties;
}

function EventCard({ ev, feedback, featured }: { ev: NearbyEvent; feedback: boolean; featured?: LiveCampaign }) {
  const cat = categoryMeta(ev.category);
  const seenRef = useSeen(featured?.id ?? null);
  // Views and taps feed the traffic ranking (counts only).
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => (cardEl ? observeEventView(cardEl, ev.event_id) : undefined), [cardEl, ev.event_id]);
  const cardRef = useCallback((el: HTMLDivElement | null) => { setCardEl(el); if (featured) seenRef(el); }, [featured, seenRef]);
  const onTap = () => countClick(ev.event_id);
  const look = flyerLook(ev.event_id);
  const body = (
    <div ref={cardRef} className="flyer flex gap-3 p-4 pt-6 sm:gap-4" style={look}>
      <div className="flex w-24 shrink-0 flex-col gap-1.5 sm:w-32">
        <time
          dateTime={ev.starts_at}
          className="rounded-md bg-black/[0.08] py-1 text-center text-sm font-bold text-[#1a1a1a]"
        >
          {startedBefore(ev) && ev.ends_at ? `Until ${formatShortDate(ev.ends_at)}` : formatTime(ev.starts_at)}
        </time>
        <VenueMiniMap lat={ev.venue_lat} lng={ev.venue_lng} venue={ev.venue_name} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className={`text-[17px] font-extrabold leading-snug text-[#1a1a1a] ${ev.cancelled ? "line-through opacity-60" : ""}`}>
            {ev.title}
          </h3>
          <span
            className="shrink-0 rounded-full border border-black/20 bg-white/60 px-2 py-0.5 text-[11px] font-semibold text-[#1a1a1a]"
          >
            {cat.emoji} {cat.label}
          </span>
        </div>
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
        <p className="mt-0.5 text-sm font-medium text-black/70">
          {ev.venue_name} · {formatDistance(ev.distance_km)} away
          {ev.price ? ` · ${ev.price_is_usual ? "usually " : ""}${ev.price}` : ""}
        </p>
        {(ev.venue_parking || ev.venue_good_to_know) && (
          <p className="mt-0.5 text-xs text-black/60">
            {ev.venue_parking ? `🅿️ ${ev.venue_parking}` : ""}
            {ev.venue_parking && ev.venue_good_to_know ? " · " : ""}
            {ev.venue_good_to_know ? `ℹ️ ${ev.venue_good_to_know}` : ""}
          </p>
        )}
        {(ev.cancelled || !!ev.uncertain_fields?.length) && (
          <div className="mt-1.5 flex flex-wrap gap-1"><UnconfirmedBadges ev={ev} /></div>
        )}
        {ev.description && (
          <p className="mt-1 line-clamp-2 text-sm text-black/65">{ev.description}</p>
        )}
        {ev.tags && ev.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ev.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded-full bg-black/[0.08] px-2 py-0.5 text-[11px] text-black/70">
                {t}
              </span>
            ))}
          </div>
        )}
        {ev.is_recurring && ev.recurrence_description && (
          <p className="mt-1 text-xs text-black/55">🔁 {ev.recurrence_description}</p>
        )}
        <GoingButton ev={ev} />
        <EventFeedback ev={ev} enabled={feedback} />
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
