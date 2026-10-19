"use client";

// Client-only localStorage simulation of accounts/RSVP/contact-exchange, so the
// whole flow is clickable in demo mode (no Supabase). Mirrors the real schema.

import type { Attendee, IncomingRequest, OutgoingRequest } from "./types";

const POOL = ["Jordan", "Alex", "Sam", "Taylor", "Mia", "Chris", "Priya", "Diego", "Noah", "Lena"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* ignore */
  }
}

/** Stable fake attendee list for an occurrence. */
export function demoAttendees(occurrenceId: string, self?: { id: string; name: string }): Attendee[] {
  const h = hash(occurrenceId);
  const count = (h % 4) + 2;
  const list: Attendee[] = [];
  for (let i = 0; i < count; i++) {
    const name = POOL[(h + i * 3) % POOL.length];
    list.push({ user_id: `demo-p-${name}`, display_name: name, avatar_url: null });
  }
  const going = read<string[]>("whatsup_going", []);
  if (self && going.includes(occurrenceId)) {
    list.unshift({ user_id: self.id, display_name: self.name, avatar_url: null });
  }
  return list;
}

const OUT_KEY = "whatsup_demo_outgoing";
const IN_KEY = "whatsup_demo_incoming";

function seedIn(): IncomingRequest[] {
  return [
    {
      id: "demo-in-1",
      requester_id: "demo-p-Jordan",
      requester_name: "Jordan",
      occurrence_id: null,
      message: "Hey! Met you at trivia at Verdugo — would love to stay in touch.",
      status: "pending",
      created_at: new Date().toISOString(),
    },
  ];
}
function seedOut(): OutgoingRequest[] {
  return [
    {
      id: "demo-out-1",
      recipient_id: "demo-p-Mia",
      recipient_name: "Mia",
      occurrence_id: null,
      status: "approved",
      shared_phone: "(323) 555-0147",
      created_at: new Date().toISOString(),
    },
  ];
}

export function demoIncoming(): IncomingRequest[] {
  const existing = read<IncomingRequest[] | null>(IN_KEY, null);
  if (existing) return existing;
  const seeded = seedIn();
  write(IN_KEY, seeded);
  return seeded;
}
export function demoOutgoing(): OutgoingRequest[] {
  const existing = read<OutgoingRequest[] | null>(OUT_KEY, null);
  if (existing) return existing;
  const seeded = seedOut();
  write(OUT_KEY, seeded);
  return seeded;
}

export function demoRespond(id: string, status: "approved" | "denied") {
  const list = demoIncoming().map((r) => (r.id === id ? { ...r, status } : r));
  write(IN_KEY, list);
}

export function demoAddOutgoing(recipient: Attendee, occurrenceId: string | null) {
  const list = demoOutgoing();
  if (list.some((r) => r.recipient_id === recipient.user_id)) return "already";
  list.unshift({
    id: `demo-out-${Date.now()}`,
    recipient_id: recipient.user_id,
    recipient_name: recipient.display_name,
    occurrence_id: occurrenceId,
    status: "pending",
    shared_phone: null,
    created_at: new Date().toISOString(),
  });
  write(OUT_KEY, list);
  return "sent";
}

export interface DemoProfile {
  display_name: string;
  phone: string;
  share_phone: boolean;
}
const PROF_KEY = "whatsup_demo_profile";
export function demoGetProfile(): DemoProfile {
  return read<DemoProfile>(PROF_KEY, { display_name: "You (demo)", phone: "", share_phone: true });
}
export function demoSaveProfile(p: DemoProfile) {
  write(PROF_KEY, p);
}
