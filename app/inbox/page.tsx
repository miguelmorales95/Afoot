"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { demoIncoming, demoOutgoing, demoRespond } from "@/lib/socialDemo";
import type { IncomingRequest, OutgoingRequest } from "@/lib/types";

export default function InboxPage() {
  const { ready, user, hasAuth, requireAuth } = useApp();
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
  const real = hasAuth && supabaseBrowser && user && !user.demo;

  const load = useCallback(async () => {
    if (!user) return;
    if (real) {
      const [inc, out] = await Promise.all([
        supabaseBrowser!.rpc("incoming_contact_requests"),
        supabaseBrowser!.rpc("outgoing_contact_requests"),
      ]);
      setIncoming((inc.data as IncomingRequest[]) ?? []);
      setOutgoing((out.data as OutgoingRequest[]) ?? []);
    } else {
      setIncoming(demoIncoming());
      setOutgoing(demoOutgoing());
    }
  }, [user, real]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (id: string, status: "approved" | "denied") => {
    if (real) {
      await supabaseBrowser!
        .from("contact_requests")
        .update({ status, responded_at: new Date().toISOString() })
        .eq("id", id);
    } else {
      demoRespond(id, status);
    }
    void load();
  };

  if (ready && !user) {
    return (
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-white/60">Sign in to see your contact requests.</p>
        <button
          onClick={requireAuth}
          className="mt-4 rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500"
        >
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40">
          Contact requests for you
        </h2>
        <div className="mt-3 space-y-2">
          {incoming.length === 0 && <p className="text-sm text-white/40">Nothing pending.</p>}
          {incoming.map((r) => (
            <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm text-white">
                <span className="font-semibold">{r.requester_name}</span> wants your contact.
              </p>
              {r.message && <p className="mt-1 text-sm text-white/50">“{r.message}”</p>}
              <div className="mt-3 flex items-center gap-2">
                {r.status === "pending" ? (
                  <>
                    <button
                      onClick={() => respond(r.id, "approved")}
                      className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500"
                    >
                      Approve &amp; share contact
                    </button>
                    <button
                      onClick={() => respond(r.id, "denied")}
                      className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5"
                    >
                      Deny
                    </button>
                  </>
                ) : (
                  <span className={`text-xs ${r.status === "approved" ? "text-emerald-300" : "text-white/40"}`}>
                    {r.status === "approved" ? "Shared ✓" : "Denied"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-white/40">
          Requests you sent
        </h2>
        <div className="mt-3 space-y-2">
          {outgoing.length === 0 && <p className="text-sm text-white/40">You haven&apos;t requested anyone yet.</p>}
          {outgoing.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <span className="text-sm text-white/80">{r.recipient_name}</span>
              {r.status === "approved" && r.shared_phone ? (
                <a href={`tel:${r.shared_phone}`} className="text-sm font-semibold text-emerald-300">
                  {r.shared_phone}
                </a>
              ) : (
                <span className={`text-xs ${r.status === "denied" ? "text-white/40" : "text-amber-300"}`}>
                  {r.status === "denied" ? "declined" : "pending approval"}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
