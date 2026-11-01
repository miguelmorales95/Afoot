"use client";

// Admin: venue newsletters. Shows the inbox address to subscribe with, venues whose newsletter
// hasn't arrived yet, "confirm your subscription" emails to click, and emails no venue matched.
// The daily job reads the events; this screen only routes the emails.
import { useCallback, useEffect, useState } from "react";

const TOKEN_KEY = "afoot_admin_token";
const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };

interface Email {
  id: string; from_address: string | null; from_name: string | null; subject: string | null;
  received_at: string | null; status: string; events_found: number | null; note: string | null; venue: string | null;
}
interface Source { id: string; from_address: string | null; from_domain: string | null; match_keyword: string | null; venue: string | null }
interface Waiting { id: string; name: string; newsletter_url: string; active: boolean }
interface Data { inbox: string; emails: Email[]; sources: Source[]; waiting: Waiting[] }

const STATUS: Record<string, string> = {
  needs_confirm: "Confirm subscription", unmatched: "No venue yet", error: "Couldn't read", queued: "Read on the next run", processed: "Read",
};

export default function NewsletterAdmin() {
  const [token] = useState(savedToken);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; city: string | null }[]>([]);
  const headers = useCallback((json = false): Record<string, string> => ({
    ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { "x-admin-token": token } : {}),
  }), [token]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/newsletters", { headers: headers() });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setData(d); else setError(d.error || "Couldn't load newsletters.");
  }, [headers]);
  useEffect(() => { void load(); }, [load]);

  const post = async (payload: object) => {
    setError(null);
    const res = await fetch("/api/admin/newsletters", { method: "POST", headers: headers(true), body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.error || "Couldn't save that."); return; }
    setAssigning(null); setFound([]); setQ("");
    await load();
  };

  const search = async () => {
    if (!q.trim()) return;
    const res = await fetch(`/api/admin/newsletters?venueSearch=${encodeURIComponent(q)}`, { headers: headers() });
    setFound((await res.json().catch(() => ({}))).venues ?? []);
  };

  if (!data && !error) return null;
  const open = data?.emails.filter((e) => e.status !== "processed") ?? [];
  const read = data?.emails.filter((e) => e.status === "processed") ?? [];

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Newsletters <span className="text-white/40">· {data?.sources.length ?? 0} senders</span></h2>
      <p className="mt-1 text-sm text-white/50">
        Subscribe <span className="select-all font-mono text-white/80">{data?.inbox}</span> to a venue&apos;s mailing list.
        Its emails are read every night; the first one from a venue&apos;s own domain is matched on its own.
      </p>
      {error && <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</p>}

      {!!data?.waiting.length && (
        <details className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
          <summary className="cursor-pointer">Waiting for a first newsletter · {data.waiting.length}</summary>
          <ul className="mt-2 space-y-1">
            {data.waiting.map((v) => (
              <li key={v.id} className="flex flex-wrap gap-2">
                <span>{v.name}</span>
                <a href={v.newsletter_url} target="_blank" rel="noreferrer" className="truncate text-fuchsia-300 underline">sign up</a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 space-y-3">
        {open.map((e) => (
          <div key={e.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{STATUS[e.status] ?? e.status}</span>
              <span className="font-medium">{e.from_name || e.from_address}</span>
              <span className="text-white/40">{e.from_address} · {e.received_at?.slice(0, 10)}</span>
            </div>
            <p className="mt-1 text-white/70">{e.subject}</p>
            {e.status === "needs_confirm" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(e.note ?? "").split("\n").filter(Boolean).map((u, i) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer" className="rounded-full bg-fuchsia-600 px-3 py-1 text-xs font-semibold hover:bg-fuchsia-500">Open confirm link {i + 1}</a>
                ))}
              </div>
            )}
            {e.status === "error" && e.note && <p className="mt-1 text-xs text-red-300">{e.note}</p>}
            {e.venue && <p className="mt-1 text-xs text-white/40">Venue: {e.venue}</p>}
            {assigning === e.id ? (
              <div className="mt-2">
                <div className="flex gap-2">
                  <input value={q} onChange={(x) => setQ(x.target.value)} placeholder="Venue name"
                    onKeyDown={(x) => { if (x.key === "Enter") void search(); }}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm outline-none" />
                  <button onClick={() => void search()} className="rounded-full bg-white/10 px-3 text-xs hover:bg-white/20">Search</button>
                </div>
                <ul className="mt-1">
                  {found.map((v) => (
                    <li key={v.id}>
                      <button onClick={() => void post({ kind: "assign", id: e.id, venueId: v.id })} className="w-full rounded-lg px-2 py-1 text-left hover:bg-white/10">
                        {v.name} <span className="text-white/40">{v.city ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                {e.status !== "needs_confirm" && (
                  <button onClick={() => { setAssigning(e.id); setFound([]); setQ(e.from_name ?? ""); }} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
                    {e.venue ? "Change venue" : "Pick venue"}
                  </button>
                )}
                <button onClick={() => void post({ kind: "done", id: e.id })} className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/5">
                  {e.status === "needs_confirm" ? "Confirmed" : "Not a newsletter"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {(read.length > 0 || (data?.sources.length ?? 0) > 0) && (
        <details className="mt-3 text-sm text-white/60">
          <summary className="cursor-pointer">Read recently ({read.length}) and known senders ({data?.sources.length ?? 0})</summary>
          <ul className="mt-2 space-y-1">
            {read.map((e) => <li key={e.id}>{e.received_at?.slice(0, 10)} · {e.venue}: {e.subject} · {e.events_found ?? 0} event(s)</li>)}
          </ul>
          <ul className="mt-2 space-y-1 text-white/40">
            {data?.sources.map((s) => <li key={s.id}>{s.from_address || s.from_domain}{s.match_keyword ? ` + “${s.match_keyword}”` : ""} → {s.venue}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
