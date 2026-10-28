"use client";

// Admin: events people pasted as links (Facebook, Eventbrite, Ticketmaster, anything). What could
// be read is filled in; fix anything wrong, then publish or reject.
import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "afoot_admin_token";
const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const CATS = ["music", "karaoke", "trivia", "games", "comedy", "market", "food", "class", "other"];

interface Details { title?: string; description?: string | null; starts_at?: string; ends_at?: string | null; url?: string; price?: string | null; category?: string; venue_name?: string | null; address?: string | null; lat?: number | null; lng?: number | null }
interface Link { id: string; url: string; source: string; extracted: Details | null; read_error: string | null; note: string | null; submitter_email: string | null; created_at: string }

/** ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input shows, in LA time. */
function toLocalInput(iso?: string | null) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).reduce((o, x) => ({ ...o, [x.type]: x.value }), {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function LinkCard({ link, onDone, headers }: { link: Link; onDone: () => void; headers: Record<string, string> }) {
  const x = link.extracted ?? {};
  const [d, setD] = useState({
    title: x.title ?? "", starts: toLocalInput(x.starts_at), ends: toLocalInput(x.ends_at), venue_name: x.venue_name ?? "",
    address: x.address ?? "", price: x.price ?? "", category: x.category ?? "other", description: x.description ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  const act = async (action: "approve" | "reject") => {
    setBusy(true); setError(null);
    // Times are typed in LA time, whatever the admin's own time zone.
    const iso = (local: string) => (local ? new Date(`${local}:00${laOffset(local)}`).toISOString() : null);
    const details = { ...x, title: d.title, description: d.description || null, starts_at: iso(d.starts), ends_at: iso(d.ends), venue_name: d.venue_name || null,
      address: d.address || null, price: d.price || null, category: d.category, url: x.url || link.url };
    const res = await fetch("/api/admin/links", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ id: link.id, action, details }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) onDone(); else setError(body.error || "That didn't work");
  };

  const input = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-fuchsia-500/50";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-fuchsia-200">{link.source}</span>
        <a href={link.url} target="_blank" rel="noreferrer noopener" className="truncate text-white/50 underline">{link.url}</a>
      </div>
      {link.read_error && <p className="mt-2 text-xs text-amber-300">Couldn&apos;t read the page: {link.read_error}. Check the details against the link.</p>}
      {link.note && <p className="mt-2 text-sm text-white/60">“{link.note}”</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-white/50 sm:col-span-2">Title<input className={input} value={d.title} onChange={set("title")} /></label>
        <label className="text-xs text-white/50">Starts (LA time)<input type="datetime-local" className={input} value={d.starts} onChange={set("starts")} /></label>
        <label className="text-xs text-white/50">Ends<input type="datetime-local" className={input} value={d.ends} onChange={set("ends")} /></label>
        <label className="text-xs text-white/50">Venue<input className={input} value={d.venue_name} onChange={set("venue_name")} /></label>
        <label className="text-xs text-white/50">Address<input className={input} value={d.address} onChange={set("address")} /></label>
        <label className="text-xs text-white/50">Price<input className={input} value={d.price} onChange={set("price")} /></label>
        <label className="text-xs text-white/50">Kind
          <select className={input} value={d.category} onChange={set("category")}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs text-white/50 sm:col-span-2">Description<textarea rows={2} className={input} value={d.description} onChange={set("description")} /></label>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button disabled={busy || !d.title || !d.starts} onClick={() => act("approve")} className="rounded-full bg-fuchsia-600 px-4 py-1.5 text-sm font-semibold hover:bg-fuchsia-500 disabled:opacity-40">Publish</button>
        <button disabled={busy} onClick={() => act("reject")} className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/70 hover:bg-white/5">Reject</button>
      </div>
    </div>
  );
}

/** "-07:00" or "-08:00": LA's offset on that local date and time. */
function laOffset(local: string) {
  const guess = new Date(`${local}:00Z`);
  const la = new Date(guess.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const utc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
  const mins = Math.round((la.getTime() - utc.getTime()) / 60000);
  const sign = mins <= 0 ? "-" : "+";
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

interface Feed { id: string; kind: string; ref: string; label: string | null; active: boolean; last_run_at: string | null; last_result: string | null }

function Feeds({ headers }: { headers: Record<string, string> }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [keys, setKeys] = useState<{ ticketmaster: boolean; eventbrite: boolean } | null>(null);
  const [kind, setKind] = useState("eventbrite_organizer");
  const [ref, setRef] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/feeds", { headers });
    const b = await res.json().catch(() => ({}));
    if (res.ok) { setFeeds(b.feeds); setKeys(b.keys); }
  }, [headers]);
  useEffect(() => { void load(); }, [load]);
  const call = async (method: string, body?: object, q = "") => {
    setError(null);
    const res = await fetch(`/api/admin/feeds${q}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) setError(b.error || "That didn't work"); else { setRef(""); setLabel(""); void load(); }
  };
  const input = "rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-fuchsia-500/50";
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Event feeds <span className="text-white/40">· {feeds.length}</span></h2>
      <p className="mt-1 text-sm text-white/50">
        Eventbrite organizers and Ticketmaster venues, pulled daily through their official APIs.
        {keys && !keys.eventbrite && " Eventbrite needs EVENTBRITE_TOKEN."}{keys && !keys.ticketmaster && " Ticketmaster needs TICKETMASTER_API_KEY."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="eventbrite_organizer">Eventbrite organizer</option>
          <option value="ticketmaster_venue">Ticketmaster venue</option>
        </select>
        <input className={`${input} min-w-64 flex-1`} value={ref} onChange={(e) => setRef(e.target.value)}
          placeholder={kind === "eventbrite_organizer" ? "https://www.eventbrite.com/o/name-12345678" : "Ticketmaster venue id (npm run ticketmaster:venues)"} />
        <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (optional)" />
        <button disabled={!ref.trim()} onClick={() => call("POST", { kind, ref, label })} className="rounded-full bg-fuchsia-600 px-4 py-1.5 text-sm font-semibold disabled:opacity-40">Add</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      <div className="mt-3 space-y-2">
        {feeds.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 px-3 py-2 text-sm">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px]">{f.kind === "eventbrite_organizer" ? "Eventbrite" : "Ticketmaster"}</span>
            <b>{f.label || f.ref}</b>
            <span className="text-white/40">{f.last_run_at ? `${new Date(f.last_run_at).toLocaleDateString()}: ${f.last_result}` : "not run yet"}</span>
            <span className="flex-1" />
            <button onClick={() => call("PATCH", { id: f.id, active: !f.active })} className="text-white/60 underline">{f.active ? "Pause" : "Resume"}</button>
            <button onClick={() => call("DELETE", undefined, `?id=${f.id}`)} className="text-red-300 underline">Remove</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EventLinkQueue() {
  const [token] = useState(savedToken);
  const [headers] = useState((): Record<string, string> => (token ? { "x-admin-token": token } : {}));
  const [links, setLinks] = useState<Link[] | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/links", { headers });
    const b = await res.json().catch(() => ({}));
    setLinks(res.ok ? b.links : []);
  }, [headers]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      {links && links.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Event links <span className="text-white/40">· {links.length}</span></h2>
          <p className="mt-1 text-sm text-white/50">Events people pasted on /submit. Check the details against the link before publishing.</p>
          <div className="mt-4 space-y-3">
            {links.map((l) => <LinkCard key={l.id} link={l} headers={headers} onDone={() => setLinks((xs) => (xs || []).filter((y) => y.id !== l.id))} />)}
          </div>
        </section>
      )}
      <Feeds headers={headers} />
    </>
  );
}
