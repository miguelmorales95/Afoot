"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ReviewGroup } from "@/lib/types";
import FlagQueue from "@/components/FlagQueue";
import EventLinkQueue from "@/components/EventLinkQueue";
import SponsorAdmin from "@/components/SponsorAdmin";

const TOKEN_KEY = "afoot_admin_token";

export default function AdminPage() {
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const t = (() => {
      try {
        return localStorage.getItem(TOKEN_KEY) || "";
      } catch {
        return "";
      }
    })();
    const res = await fetch("/api/admin/review", {
      headers: t ? { "x-admin-token": t } : {},
    });
    if (res.status === 401) {
      setNeedToken(true);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setGroups(data.groups ?? []);
    setDemo(!!data.demo);
    setNeedToken(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveToken = () => {
    try {
      localStorage.setItem(TOKEN_KEY, token.trim());
    } catch {
      /* ignore */
    }
    void load();
  };

  const act = async (group: ReviewGroup, action: "approve" | "reject") => {
    setBusy(group.domain);
    const t = (() => {
      try {
        return localStorage.getItem(TOKEN_KEY) || "";
      } catch {
        return "";
      }
    })();
    const res = await fetch("/api/admin/review", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(t ? { "x-admin-token": t } : {}) },
      body: JSON.stringify({ action, group }),
    });
    if (res.ok) setGroups((g) => g.filter((x) => x.domain !== group.domain));
    setBusy(null);
  };

  if (needToken) {
    return (
      <main className="mx-auto max-w-sm px-4 py-20">
        <h1 className="text-xl font-bold">Admin access</h1>
        <p className="mt-2 text-sm text-white/50">Enter the admin token to review submissions.</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-fuchsia-500/50"
        />
        <button
          onClick={saveToken}
          className="mt-3 w-full rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500"
        >
          Unlock
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Review queue</h1>
        <Link href="/" className="text-sm text-white/50 hover:text-white">
          ← back to site
        </Link>
      </div>
      <p className="mt-2 text-sm text-white/50">
        Community submissions + crawler finds, grouped by site, with venues you already track
        removed. Approve to add the venue; the next ingest pulls its events.
      </p>

      {demo && (
        <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          Demo mode — sample data. Approving/rejecting won&apos;t save anything.
        </p>
      )}

      {!loading && !demo && <EventLinkQueue />}

      {!loading && !demo && <FlagQueue />}

      {!loading && !demo && <SponsorAdmin />}

      {loading && <p className="mt-10 text-white/40">Loading…</p>}

      {!loading && groups.length === 0 && (
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.02] px-6 py-16 text-center text-white/50">
          🎉 Nothing to review right now.
        </div>
      )}

      <div className="mt-6 space-y-4">
        {groups.map((g) => (
          <div key={g.domain} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">{g.name}</h2>
                  {g.score != null && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300 ring-1 ring-emerald-500/30">
                      {(g.score * 100).toFixed(0)}% match
                    </span>
                  )}
                  {g.sources.length > 1 && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
                      {g.sources.length} suggestions
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-white/50">
                  {g.website ? (
                    <a href={g.website} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                      {g.domain}
                    </a>
                  ) : (
                    g.domain
                  )}
                  {g.neighborhood ? ` · ${g.neighborhood}` : g.city ? ` · ${g.city}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => act(g, "reject")}
                  disabled={busy === g.domain}
                  className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-white/60 hover:bg-white/5 disabled:opacity-40"
                >
                  Reject
                </button>
                <button
                  onClick={() => act(g, "approve")}
                  disabled={busy === g.domain}
                  className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  Approve
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {g.events_url && (
                <a href={g.events_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/5 px-2.5 py-1 text-white/60 hover:bg-white/10">
                  📅 events page
                </a>
              )}
              {g.newsletter_url && (
                <a href={g.newsletter_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/5 px-2.5 py-1 text-white/60 hover:bg-white/10">
                  ✉️ newsletter
                </a>
              )}
            </div>

            <ul className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
              {g.sources.map((s) => (
                <li key={s.id} className="flex gap-2 text-sm">
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                      s.kind === "submission"
                        ? "bg-sky-500/15 text-sky-300"
                        : "bg-violet-500/15 text-violet-300"
                    }`}
                  >
                    {s.kind === "submission" ? "person" : "crawler"}
                  </span>
                  <span className="text-white/60">{s.note || "(no note)"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </main>
  );
}
