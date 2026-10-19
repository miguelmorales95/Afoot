"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/components/AppProvider";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import {
  demoAttendees,
  demoMessages,
  demoSendMessage,
  demoAddOutgoing,
} from "@/lib/socialDemo";
import type { Attendee, ChatMessage } from "@/lib/types";

// light, local-first moderation gesture (server RLS + reports/blocks do the real work)
const BAD = /\b(fuck|shit|bitch|asshole)\b/gi;
const mask = (s: string) => s.replace(BAD, (m) => m[0] + "*".repeat(m.length - 1));

export default function ChatPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-2xl px-4 py-20 text-center text-white/40">Loading chat…</main>}>
      <ChatInner />
    </Suspense>
  );
}

function ChatInner() {
  const params = useParams();
  const search = useSearchParams();
  const occId = String(params.occurrenceId);
  const title = search.get("t") || "Event chat";
  const venue = search.get("v") || "";

  const { ready, user, hasAuth, goingSet, toggleGoing, requireAuth } = useApp();
  const real = hasAuth && user && !user.demo;
  const going = goingSet.has(occId);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<Attendee[]>([]);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [showPeople, setShowPeople] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user || !going) return;
    if (real) {
      const [msgs, att] = await Promise.all([
        supabaseBrowser!.rpc("occurrence_messages", { in_occurrence_id: occId }),
        supabaseBrowser!.rpc("occurrence_attendees", { in_occurrence_id: occId }),
      ]);
      setMessages((msgs.data as ChatMessage[]) ?? []);
      setPeople((att.data as Attendee[]) ?? []);
    } else {
      setMessages(demoMessages(occId));
      setPeople(demoAttendees(occId, { id: user.id, name: user.name }));
    }
  }, [user, going, real, occId]);

  useEffect(() => {
    void load();
    if (!going) return;
    const iv = setInterval(load, real ? 4000 : 2500);
    return () => clearInterval(iv);
  }, [load, going, real]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const body = mask(draft.trim()).slice(0, 500);
    if (!body || !user) return;
    setDraft("");
    if (real) {
      await supabaseBrowser!.from("messages").insert({ occurrence_id: occId, user_id: user.id, body });
    } else {
      demoSendMessage(occId, { id: user.id, name: user.name }, body);
    }
    void load();
  };

  const requestContact = async (a: Attendee) => {
    if (!user) return;
    const note = window.prompt(`Short note for ${a.display_name} (they approve before sharing contact):`, "");
    if (note === null) return;
    if (real) {
      await supabaseBrowser!.from("contact_requests").insert({
        recipient_id: a.user_id,
        occurrence_id: occId,
        message: note || null,
      });
      setSent((s) => ({ ...s, [a.user_id]: "sent" }));
    } else {
      setSent((s) => ({ ...s, [a.user_id]: demoAddOutgoing(a, occId) }));
    }
  };

  const blockUser = async (uid: string) => {
    setBlocked((b) => new Set(b).add(uid));
    if (real) await supabaseBrowser!.from("blocks").insert({ blocker_id: user!.id, blocked_id: uid });
  };
  const report = async (m: ChatMessage) => {
    if (real)
      await supabaseBrowser!.from("reports").insert({
        reporter_id: user!.id,
        subject_id: m.user_id,
        kind: "message",
        ref_id: m.id,
        reason: "reported from chat",
      });
    alert("Thanks — reported to moderators.");
  };

  // --- gating ---
  if (ready && !user) {
    return (
      <Gate title={title} venue={venue}>
        <p className="text-white/60">Sign in and RSVP to join this event&apos;s chat.</p>
        <button onClick={requireAuth} className="mt-4 rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-semibold hover:bg-fuchsia-500">
          Sign in
        </button>
      </Gate>
    );
  }
  if (ready && user && !going) {
    return (
      <Gate title={title} venue={venue}>
        <p className="text-white/60">The chat is for people going to this event — a small, real crowd.</p>
        <button
          onClick={() => toggleGoing(occId)}
          className="mt-4 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold hover:bg-emerald-500"
        >
          I&apos;m going — join the chat
        </button>
      </Gate>
    );
  }

  const visibleMessages = messages.filter((m) => !blocked.has(m.user_id));

  return (
    <main className="mx-auto flex h-[calc(100vh-56px)] max-w-2xl flex-col px-4">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 py-3">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-white/40 hover:text-white">← back</Link>
          <h1 className="truncate font-semibold text-white">{title}</h1>
          {venue && <p className="truncate text-xs text-white/40">{venue}</p>}
        </div>
        <button
          onClick={() => setShowPeople((s) => !s)}
          className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
        >
          👥 Going ({people.length})
        </button>
      </div>

      {showPeople && (
        <div className="border-b border-white/10 py-2">
          <p className="mb-1 text-[11px] text-white/40">
            🔒 Only people going see each other. Request a number — they approve before it&apos;s shared.
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto">
            {people.map((a) => {
              const self = a.user_id === user!.id;
              return (
                <li key={a.user_id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white/80">{a.display_name}{self && <span className="text-white/30"> (you)</span>}</span>
                  {!self &&
                    (sent[a.user_id] ? (
                      <span className="text-xs text-emerald-300">{sent[a.user_id] === "already" ? "requested" : "request sent"}</span>
                    ) : (
                      <button onClick={() => requestContact(a)} className="rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">
                        Request contact
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {visibleMessages.length === 0 && (
          <p className="py-10 text-center text-sm text-white/30">No messages yet — say hi 👋</p>
        )}
        {visibleMessages.map((m) => {
          const mine = m.user_id === user!.id;
          return (
            <div key={m.id} className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-fuchsia-600 text-white" : "bg-white/10 text-white/90"}`}>
                {!mine && <div className="mb-0.5 text-[11px] font-medium text-white/50">{m.display_name}</div>}
                <div>{m.body}</div>
              </div>
              {!mine && (
                <div className="ml-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => report(m)} title="Report" className="text-xs text-white/30 hover:text-white">⚑</button>
                  <button onClick={() => blockUser(m.user_id)} title="Block" className="text-xs text-white/30 hover:text-white">🚫</button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 border-t border-white/10 py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Message the group…"
          className="flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-fuchsia-500/50"
        />
        <button onClick={send} className="rounded-full bg-fuchsia-600 px-4 py-2.5 text-sm font-semibold hover:bg-fuchsia-500">
          Send
        </button>
      </div>
    </main>
  );
}

function Gate({ title, venue, children }: { title: string; venue: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <Link href="/" className="text-xs text-white/40 hover:text-white">← back</Link>
      <h1 className="mt-2 text-xl font-bold text-white">{title}</h1>
      {venue && <p className="text-sm text-white/40">{venue}</p>}
      <div className="mt-6">{children}</div>
    </main>
  );
}
