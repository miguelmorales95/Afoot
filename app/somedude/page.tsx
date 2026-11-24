"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { pageCards, type PageCards } from "@/lib/pageCards";
import type { PastedEvent } from "@/lib/somedude";

// The somedude desk: paste (or drop a saved copy of) an events page, check what's new, put it on
// the pole. Only for accounts in afoot.somedudes; see lib/somedude.ts.

type Phase = "idle" | "reading" | "review" | "adding" | "done";
type Result = { title: string; ok: boolean; note: string };

// Claude reads ~1 Facebook card a second; keep each call well under the 60 s limit.
// Where somedudes look for events we don't get on our own: sites with no API (or a paid one).
// LA pages where the site has one; other cities get the site's general events page.
const SITES: { name: string; mark: string; bg: string; fg: string; la: string; any: string }[] = [
  { name: "Facebook Events", mark: "f", bg: "#1877f2", fg: "#fff", la: "https://www.facebook.com/events/", any: "https://www.facebook.com/events/" },
  { name: "Meetup", mark: "M", bg: "#f65858", fg: "#fff", la: "https://www.meetup.com/find/?source=EVENTS&location=us--ca--Los%20Angeles", any: "https://www.meetup.com/find/?source=EVENTS" },
  { name: "Resident Advisor", mark: "RA", bg: "#f3ece2", fg: "#111", la: "https://ra.co/events/us/losangeles", any: "https://ra.co/events" },
  { name: "Luma", mark: "L", bg: "#ff8ad8", fg: "#111", la: "https://luma.com/los-angeles", any: "https://luma.com/discover" },
  { name: "Partiful", mark: "P", bg: "#7c3aed", fg: "#fff", la: "https://partiful.com/explore", any: "https://partiful.com/explore" },
  { name: "Posh", mark: "PO", bg: "#111", fg: "#fff", la: "https://posh.vip/explore", any: "https://posh.vip/explore" },
  { name: "AllEvents", mark: "AE", bg: "#ff9a3c", fg: "#111", la: "https://allevents.in/los-angeles", any: "https://allevents.in" },
];

const PARSE_BATCH = 20, ADD_BATCH = 8;
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
const when = (e: PastedEvent) => `${DAY.format(new Date(e.start))} · ${e.time_unknown ? "Time TBA" : TIME.format(new Date(e.start))}`;
const short = (n: number | null) => (n == null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));

async function call(body: unknown) {
  const { data } = (await supabaseBrowser?.auth.getSession()) ?? { data: { session: null } };
  const res = await fetch("/api/somedude", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

export default function SomedudePage() {
  const { ready, user, requireAuth } = useApp();
  const [area, setArea] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [page, setPage] = useState<PageCards | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [events, setEvents] = useState<PastedEvent[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!ready || !user) return;
    call({ action: "me" }).then((r) => setArea(r.area), (e) => setDenied((e as Error).message));
  }, [ready, user]);

  function take(html: string, text = "") {
    setError(null); setEvents([]); setResults([]); setPhase("idle");
    const p = pageCards(html, text);
    if (!p.cards.length) { setError("Couldn't find any text in that. Try selecting the whole page (Ctrl+A) before copying."); return; }
    setPage(p);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    take(await f.text());
  }

  async function read() {
    if (!page) return;
    setPhase("reading"); setProgress(0); setError(null);
    const found: PastedEvent[] = [];
    // Facebook cards are short (20 per call); page chunks are long (2 per call).
    const per = page.kind === "facebook" ? PARSE_BATCH : 2;
    try {
      for (let i = 0; i < page.cards.length; i += per) {
        const r = await call({ action: "parse", cards: page.cards.slice(i, i + per) });
        found.push(...r.events);
        setProgress(Math.min(1, (i + per) / page.cards.length));
      }
    } catch (e) { setError(`Stopped partway: ${(e as Error).message}`); }
    found.sort((a, b) => a.start.localeCompare(b.start));
    setEvents(found);
    setPicked(new Set(found.map((e, i) => (e.status === "new" ? i : -1)).filter((i) => i >= 0)));
    setPhase("review");
  }

  async function add() {
    const list = events.filter((_, i) => picked.has(i));
    setPhase("adding"); setProgress(0); setError(null);
    const out: Result[] = [];
    try {
      for (let i = 0; i < list.length; i += ADD_BATCH) {
        const r = await call({ action: "add", events: list.slice(i, i + ADD_BATCH) });
        out.push(...r.results);
        setProgress(Math.min(1, (i + ADD_BATCH) / list.length));
      }
    } catch (e) { setError(`Stopped partway: ${(e as Error).message}`); }
    setResults(out);
    setPhase("done");
    call({ action: "done", kind: page?.kind, events, results: out }).catch(() => {});
  }

  const counts = useMemo(() => ({
    new: events.filter((e) => e.status === "new").length,
    already: events.filter((e) => e.status === "already").length,
    skipped: events.filter((e) => e.status === "skipped").length,
  }), [events]);

  if (!ready) return null;
  if (!user || user.demo) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-poster text-4xl uppercase text-[#fff23a]">Somedude desk</h1>
        <p className="mt-3 text-white/70">Sign in to paste events onto the pole.</p>
        <button type="button" onClick={requireAuth} className="mt-6 rounded-full bg-[#f3ece2] px-5 py-2.5 font-bold text-black">Sign in</button>
      </main>
    );
  }
  if (denied) {
    return (
      <main className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="font-poster text-4xl uppercase text-[#fff23a]">Somedude desk</h1>
        <p className="mt-3 text-white/70">This page is for the person running Light Pole in each city. Want to be that person somewhere? <a className="underline" href="/submit?kind=source&type=instagram&mine=1">Say hi</a>.</p>
      </main>
    );
  }
  if (!area) return null;

  const busy = phase === "reading" || phase === "adding";
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-poster text-[40px] uppercase leading-none"><span className="text-[#fff23a]">Somedude</span> <span className="text-[#ff5fae]">desk</span></h1>
      <p className="mt-2 text-sm text-white/60">{area} · paste a page of events, see what we&apos;re missing, put it on the pole.</p>

      {/* Shortcuts to the sites worth pasting from. */}
      <nav aria-label="Where to look" className="mt-5">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/50">Where to look</p>
        <ul className="mt-2 flex flex-wrap gap-3">
          {SITES.map((site) => (
            <li key={site.name}>
              <a href={/angeles/i.test(area) ? site.la : site.any} target="_blank" rel="noopener noreferrer" title={site.name}
                className="group flex w-16 flex-col items-center gap-1 text-center">
                <span className="flex size-12 items-center justify-center rounded-full text-[17px] font-extrabold ring-2 ring-transparent transition group-hover:ring-white/70 group-focus-visible:ring-white"
                  style={{ background: site.bg, color: site.fg }} aria-hidden>{site.mark}</span>
                <span className="text-[11px] font-semibold leading-tight text-white/70 group-hover:text-white">{site.name.replace(" Events", "")}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* 1. Paste or drop */}
      <div className="flyer mt-6 px-4 pb-5 pt-6 text-[#2a2016] sm:px-6" style={{ "--paper": "#cdae7e", "--tilt": "0deg" } as React.CSSProperties}>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-black/55">1 · Grab a page</p>
        <p className="mt-1 text-[14px] font-medium leading-snug text-black/75">
          On a computer, open Facebook Events (or any events listing), scroll so it loads a bunch, then <b>Ctrl+A</b>, <b>Ctrl+C</b> and paste in the box. Or save the page (<b>Ctrl+S</b>) and drop the .html file here.
        </p>
        <div
          role="textbox"
          aria-label="Paste an events page here"
          tabIndex={0}
          contentEditable={!busy}
          suppressContentEditableWarning
          onPaste={(e) => { e.preventDefault(); take(e.clipboardData.getData("text/html"), e.clipboardData.getData("text/plain")); }}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]); }}
          onDragOver={(e) => e.preventDefault()}
          onKeyDown={(e) => { if (!(e.ctrlKey || e.metaKey)) e.preventDefault(); }}
          className="mt-3 flex min-h-28 items-center justify-center rounded border-[1.5px] border-dashed border-black/40 bg-white/25 px-3 text-center text-[14px] font-bold text-black/60 outline-none focus:border-black/70"
        >
          {page ? `Got it: ${page.kind === "facebook" ? `${page.cards.length} Facebook events` : `${Math.round(page.chars / 1000)}K characters of page`}. Paste again to replace.` : "Paste here, or drop a saved page"}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="text-[13px] font-extrabold underline underline-offset-2">Pick a saved page…</button>
          <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <button type="button" onClick={read} disabled={!page || busy}
            className="ml-auto rounded-full bg-black px-5 py-2.5 text-[14px] font-extrabold text-[#cdae7e] disabled:opacity-40">
            {phase === "reading" ? `Reading… ${Math.round(progress * 100)}%` : "Find events"}
          </button>
        </div>
      </div>

      {error && <p className="mt-4 rounded bg-red-500/15 px-3 py-2 text-sm text-red-200">{error}</p>}

      {/* 2. Review */}
      {(phase === "review" || phase === "adding" || phase === "done") && (
        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-poster text-[28px] uppercase leading-none text-[#86f45c]">2 · What&apos;s new</h2>
            <p className="text-sm text-white/60">{counts.new} new · {counts.already} already on the pole · {counts.skipped} skipped</p>
          </div>
          {phase === "review" && counts.new > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={add} disabled={!picked.size}
                className="rounded-full bg-[#86f45c] px-5 py-2.5 font-extrabold text-black disabled:opacity-40">Add {picked.size} to the pole</button>
              <button type="button" className="text-sm text-white/60 underline" onClick={() => setPicked(picked.size ? new Set() : new Set(events.map((e, i) => (e.status === "new" ? i : -1)).filter((i) => i >= 0)))}>
                {picked.size ? "Uncheck all" : "Check all"}
              </button>
            </div>
          )}
          {phase === "adding" && <p className="mt-3 font-bold text-[#86f45c]">Adding… {Math.round(progress * 100)}%</p>}
          {phase === "done" && (
            <p className="mt-3 rounded bg-[#86f45c]/15 px-3 py-2 text-sm text-[#d9ffc9]">
              Added {results.filter((r) => r.ok).length} event{results.filter((r) => r.ok).length === 1 ? "" : "s"}. They're on the pole now, ranked and with their voice lines.
              {results.some((r) => !r.ok) && ` ${results.filter((r) => !r.ok).length} didn't go in (listed below).`}
            </p>
          )}

          <ul className="mt-4 divide-y divide-white/10 rounded-lg bg-white/[0.04]">
            {events.map((e, i) => {
              const res = phase === "done" ? results.find((r) => r.title === e.title) : undefined;
              return (
                <li key={i} className={`flex gap-3 px-3 py-2.5 ${e.status !== "new" ? "opacity-55" : ""}`}>
                  <input type="checkbox" aria-label={`Add ${e.title}`} className="mt-1 size-4 accent-[#86f45c]"
                    disabled={e.status !== "new" || phase !== "review"} checked={picked.has(i)}
                    onChange={() => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold leading-snug">
                      {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{e.title}</a> : e.title}
                    </p>
                    <p className="text-[13px] text-white/60">
                      {when(e)} · {e.venue || e.address || e.city || "place?"}
                      {e.interested != null && <> · <b className="text-white/80">{short(e.interested)}</b> interested{e.going != null && ` · ${short(e.going)} going`}</>}
                    </p>
                    {e.status !== "new" && <p className="text-[12px] text-white/50">{e.status === "already" ? `Already on the pole: ${e.why}` : `Skipped: ${e.why}`}</p>}
                    {res && <p className={`text-[12px] ${res.ok ? "text-[#86f45c]" : "text-red-300"}`}>{res.ok ? "✓ " : "✗ "}{res.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
