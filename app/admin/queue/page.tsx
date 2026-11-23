"use client";

// The founder queue: one card at a time, built for a phone. Each card is one venue with a gap
// (address or price) and one answer fixes every upcoming date there.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const TOKEN_KEY = "afoot_admin_token";
const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const PRICE_CHOICES = ["Free", "Pay what you can", "Varies (see link)", "$5", "$10", "$15", "$20", "$25", "$30"];
const STATUSES = [
  ["not_contacted", "Not contacted"], ["contacted", "Contacted"], ["talking", "Talking"], ["paying", "Paying ✅"], ["declined", "Said no"],
] as const;

interface Venue {
  id: string; name: string; website: string | null; events_url: string | null; address: string | null; city: string | null;
  area: string | null; outreach_status: string; outreach_count: number; outreach_last_at: string | null; outreach_notes: string | null;
  dates: number; soonDates: number; noPriceDates: number; nextAt: string | null; titles: string[]; knownPrices: string[];
}
interface Card { kind: "address" | "price"; venue: Venue; fixes: number; planned: boolean }
interface QueueData { cards: Card[]; remaining: number; totals: { dates: number; noAddressDates: number; noPriceDates: number }; waiting: { links: number; flags: number; submissions: number } }

function useApi() {
  const headers = useMemo(() => ({ "Content-Type": "application/json", "x-admin-token": savedToken() }), []);
  const get = useCallback(async (q = "") => {
    const res = await fetch(`/api/admin/queue${q}`, { headers });
    if (res.status === 401) throw new Error("unauthorized");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    return data;
  }, [headers]);
  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/queue", { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed");
    return data;
  }, [headers]);
  return { get, post };
}

const btn = "rounded-full px-4 py-3 text-sm font-semibold disabled:opacity-40";
const chip = (on: boolean) => `rounded-full px-3 py-2 text-sm ${on ? "bg-fuchsia-600 text-white" : "bg-white/10 text-white/80"}`;
const ago = (iso: string | null) => (iso ? `${Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 864e5))}d ago` : "never");

function VenueLinks({ v }: { v: Venue }) {
  const q = encodeURIComponent(`${v.name} ${v.city || "Los Angeles"}`);
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {v.website && <a href={v.website} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/5 px-3 py-1.5 text-white/70">🌐 website</a>}
      {v.events_url && v.events_url !== v.website && <a href={v.events_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/5 px-3 py-1.5 text-white/70">📅 events page</a>}
      <a href={`https://www.google.com/maps/search/${q}`} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/5 px-3 py-1.5 text-white/70">📍 search maps</a>
    </div>
  );
}

function QueueCard({ card, onDone, api }: { card: Card; onDone: (fixed: number) => void; api: ReturnType<typeof useApi> }) {
  const v = card.venue;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { setValue(""); setError(null); setNote(null); }, [card]);

  const lookup = async () => {
    setBusy(true); setError(null);
    try { const { address } = await api.get(`?suggest=${v.id}`); address ? setValue(address) : setNote("No match on the map. Try the maps link."); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.post({ action: card.kind, venueId: v.id, value, dates: card.fixes });
      if (card.kind === "address" && r.geocoded === false) setNote("Saved, but the map couldn't place it. The pin will be missing.");
      onDone(card.fixes);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  const skip = async () => { setBusy(true); await api.post({ action: "skip", venueId: v.id }).catch(() => {}); setBusy(false); onDone(0); };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide">
        <span className={`rounded-full px-2.5 py-1 ${card.kind === "address" ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300"}`}>
          {card.kind === "address" ? "Missing address" : "Missing price"}
        </span>
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-emerald-300">fixes {card.fixes} dates</span>
        {card.planned && <span className="rounded-full bg-fuchsia-500/15 px-2.5 py-1 text-fuchsia-300">this week&apos;s plan</span>}
      </div>
      <h2 className="mt-3 text-2xl font-bold leading-tight">{v.name}</h2>
      <p className="mt-1 text-sm text-white/50">
        {v.area || v.city || "Los Angeles"} · {v.soonDates} in the next 2 weeks{v.address && card.kind === "price" ? ` · ${v.address}` : ""}
      </p>
      <ul className="mt-3 space-y-1 text-sm text-white/70">
        {v.titles.map((t) => <li key={t} className="truncate">• {t}</li>)}
      </ul>
      <VenueLinks v={v} />

      {card.kind === "address" ? (
        <div className="mt-5">
          <button onClick={lookup} disabled={busy} className="text-sm text-fuchsia-300 underline">Look it up on the map</button>
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} placeholder="Street address, city"
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base outline-none focus:border-fuchsia-500/50" />
        </div>
      ) : (
        <div className="mt-5">
          {v.knownPrices.length > 0 && <p className="mb-2 text-xs text-white/40">Other events here: {v.knownPrices.join(" · ")}</p>}
          <div className="flex flex-wrap gap-2">
            {[...new Set([...v.knownPrices, ...PRICE_CHOICES])].map((p) => (
              <button key={p} onClick={() => setValue(p)} className={chip(value === p)}>{p}</button>
            ))}
          </div>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="or type it, e.g. $12 advance"
            className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base outline-none focus:border-fuchsia-500/50" />
          <p className="mt-2 text-xs text-white/40">Applies to every event here with no price, and to new ones.</p>
        </div>
      )}

      {note && <p className="mt-3 text-sm text-amber-300">{note}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button onClick={skip} disabled={busy} className={`${btn} border border-white/15 text-white/70`}>Skip a week</button>
        <button onClick={save} disabled={busy || !value.trim()} className={`${btn} bg-emerald-600 text-white`}>Save</button>
      </div>
    </div>
  );
}

function QueueTab({ api }: { api: ReturnType<typeof useApi> }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [i, setI] = useState(0);
  const [session, setSession] = useState({ cards: 0, dates: 0 });
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { setData(null); setI(0); api.get().then(setData, (e) => setError(e.message)); }, [api]);
  useEffect(load, [load]);

  if (error) return <p className="mt-8 text-red-400">{error}</p>;
  if (!data) return <p className="mt-8 text-white/40">Loading the queue…</p>;
  const card = data.cards[i];
  const w = data.waiting;
  return (
    <div className="mt-6">
      <p className="text-sm text-white/50">
        {data.totals.noAddressDates} dates missing an address, {data.totals.noPriceDates} missing a price, of {data.totals.dates} upcoming.
      </p>
      {session.cards > 0 && <p className="mt-1 text-sm text-emerald-300">This session: {session.cards} done, {session.dates} dates fixed.</p>}
      <div className="mt-4">
        {card ? (
          <QueueCard card={card} api={api} onDone={(fixed) => { if (fixed) setSession((s) => ({ cards: s.cards + 1, dates: s.dates + fixed })); setI(i + 1); }} />
        ) : (
          <div className="rounded-3xl border border-white/10 px-6 py-14 text-center text-white/60">
            Done for now. <button onClick={load} className="text-fuchsia-300 underline">Load more</button>
          </div>
        )}
      </div>
      {card && <p className="mt-3 text-center text-xs text-white/40">Card {i + 1} of {data.remaining}</p>}
      {(w.links + w.flags + w.submissions) > 0 && (
        <Link href="/admin" className="mt-6 block rounded-2xl border border-white/10 px-4 py-3 text-sm text-white/70">
          Also waiting in the full admin: {w.links} event links, {w.submissions} venue submissions, {w.flags} reports →
        </Link>
      )}
    </div>
  );
}

function OutreachRow({ v, api }: { v: Venue; api: ReturnType<typeof useApi> }) {
  const [row, setRow] = useState(v);
  const [notes, setNotes] = useState(v.outreach_notes ?? "");
  const [open, setOpen] = useState(false);
  const save = async (patch: Record<string, unknown>, local: Partial<Venue>) => {
    setRow((r) => ({ ...r, ...local }));
    await api.post({ action: "outreach", venueId: v.id, ...patch }).catch(() => {});
  };
  return (
    <li className="rounded-2xl border border-white/10 p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => setOpen(!open)} className="min-w-0 text-left">
          <div className="truncate font-semibold">{row.name}</div>
          <div className="text-xs text-white/50">{row.area || row.city || "LA"} · {row.dates} dates · contacted {row.outreach_count}× ({ago(row.outreach_last_at)})</div>
        </button>
        <button onClick={() => save({ contacted: true }, { outreach_count: row.outreach_count + 1, outreach_last_at: new Date().toISOString(), outreach_status: row.outreach_status === "not_contacted" ? "contacted" : row.outreach_status })}
          className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold">+1 contact</button>
      </div>
      <select value={row.outreach_status} onChange={(e) => save({ status: e.target.value }, { outreach_status: e.target.value })}
        className="mt-2 w-full rounded-xl border border-white/10 bg-[#14141c] px-3 py-2 text-sm">
        {STATUSES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {open && (
        <div className="mt-2">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Who you talked to, what they said"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm" />
          <button onClick={() => save({ notes }, { outreach_notes: notes })} className="mt-1 text-xs text-fuchsia-300 underline">Save notes</button>
          {row.address && <p className="mt-1 text-xs text-white/40">{row.address}</p>}
        </div>
      )}
    </li>
  );
}

function OutreachTab({ api }: { api: ReturnType<typeof useApi> }) {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [filter, setFilter] = useState("open");
  const [q, setQ] = useState("");
  useEffect(() => { api.get("?view=outreach").then((d) => setVenues(d.venues), () => setVenues([])); }, [api]);
  if (!venues) return <p className="mt-8 text-white/40">Loading venues…</p>;
  const shown = venues.filter((v) =>
    (filter === "all" || (filter === "open" ? !["paying", "declined"].includes(v.outreach_status) : v.outreach_status === filter)) &&
    (!q || `${v.name} ${v.area ?? ""} ${v.city ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="mt-6">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search venue or area"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base" />
      <div className="mt-3 flex flex-wrap gap-2">
        {[["open", "Not yes/no yet"], ["paying", "Paying"], ["declined", "Said no"], ["all", "All"]].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={chip(filter === k)}>{l}</button>
        ))}
      </div>
      <ul className="mt-4 space-y-2">{shown.slice(0, 100).map((v) => <OutreachRow key={v.id} v={v} api={api} />)}</ul>
    </div>
  );
}

function PromptTab({ api }: { api: ReturnType<typeof useApi> }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.get("?view=settings").then((d) => { setPrompt(d.rankingPrompt); setPlan(d.weeklyPlan); }, () => setPrompt("")); }, [api]);
  if (prompt === null) return <p className="mt-8 text-white/40">Loading…</p>;
  let planText = "";
  try { planText = plan ? JSON.parse(plan).summary ?? "" : ""; } catch { /* old format */ }
  return (
    <div className="mt-6">
      <p className="text-sm text-white/60">The AI reads this before it ranks the queue and writes the Monday, Thursday and Saturday emails. Change it any time.</p>
      <textarea value={prompt} onChange={(e) => { setPrompt(e.target.value); setSaved(false); }} rows={12}
        className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed" />
      <button onClick={() => api.post({ action: "prompt", value: prompt }).then(() => setSaved(true))} className={`${btn} mt-2 w-full bg-fuchsia-600 text-white`}>
        {saved ? "Saved ✓" : "Save prompt"}
      </button>
      {planText && (<><h3 className="mt-8 font-semibold">This week&apos;s plan</h3><p className="mt-2 whitespace-pre-line text-sm text-white/70">{planText}</p></>)}
    </div>
  );
}

export default function FounderQueuePage() {
  const api = useApi();
  const [tab, setTab] = useState<"queue" | "outreach" | "prompt">("queue");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [token, setToken] = useState("");

  useEffect(() => { api.get("?view=settings").then(() => setAuthed(true), () => setAuthed(false)); }, [api]);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "outreach" || t === "prompt") setTab(t);
  }, []);

  if (authed === false) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20">
        <h1 className="text-xl font-bold">Admin access</h1>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN"
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base" />
        <button onClick={() => { try { localStorage.setItem(TOKEN_KEY, token.trim()); } catch { /* ignore */ } window.location.reload(); }}
          className={`${btn} mt-3 w-full bg-fuchsia-600 text-white`}>Unlock</button>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Afoot to-do</h1>
        <Link href="/admin" className="text-sm text-white/50">Full admin →</Link>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {([["queue", "Fill gaps"], ["outreach", "Venues"], ["prompt", "AI prompt"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={chip(tab === k)}>{l}</button>
        ))}
      </div>
      {authed && tab === "queue" && <QueueTab api={api} />}
      {authed && tab === "outreach" && <OutreachTab api={api} />}
      {authed && tab === "prompt" && <PromptTab api={api} />}
    </main>
  );
}
