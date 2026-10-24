"use client";

// Browser side of sponsor cards: fetch the live campaigns once per page load, and report
// which cards were actually seen. A "view" is a card at least half on screen, counted
// once per page view; ids are batched and sent with navigator.sendBeacon when the page is
// hidden (or the batch fills up). Nothing identifying is sent or kept: just the ids.
import { useEffect, useState } from "react";
import type { LiveCampaign } from "./ads";

let pending: Promise<LiveCampaign[]> | null = null;

function loadCampaigns(): Promise<LiveCampaign[]> {
  pending ??= fetch("/api/ads/live")
    .then((r) => (r.ok ? r.json() : { campaigns: [] }))
    .then((d: { campaigns?: LiveCampaign[] }) => d.campaigns ?? [])
    .catch(() => []);
  return pending;
}

/** Live campaigns ([] until loaded, or if anything fails: slots then show house ads). */
export function useLiveCampaigns(): LiveCampaign[] {
  const [list, setList] = useState<LiveCampaign[]>([]);
  useEffect(() => {
    let alive = true;
    void loadCampaigns().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

const SEEN_URL = "/api/ads/seen";
const MAX_PER_BEACON = 10; // the endpoint ignores bigger batches
const SEND_AT = 5; // send early once a few cards have been seen

const reported = new Set<string>(); // this page view
let queue: string[] = [];
let listening = false;

function flush() {
  while (queue.length) {
    const body = JSON.stringify({ ids: queue.splice(0, MAX_PER_BEACON) });
    // text/plain keeps sendBeacon a "simple" request.
    const sent = navigator.sendBeacon?.(SEEN_URL, new Blob([body], { type: "text/plain" }));
    if (!sent) void fetch(SEEN_URL, { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

function markSeen(id: string) {
  if (reported.has(id)) return;
  reported.add(id);
  queue.push(id);
  listen();
  if (queue.length >= SEND_AT) flush();
}

/** Watch a sponsor card; it counts as seen the first time >= 50% of it is on screen. */
export function observeSeen(el: Element, id: string): () => void {
  if (reported.has(id) || typeof IntersectionObserver === "undefined") return () => {};
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
        markSeen(id);
        io.disconnect();
      }
    },
    { threshold: 0.5 },
  );
  io.observe(el);
  return () => io.disconnect();
}

/** Ref-style hook: attach to a paid card's root element. */
export function useSeen(id: string | null) {
  const [el, setEl] = useState<Element | null>(null);
  useEffect(() => (el && id ? observeSeen(el, id) : undefined), [el, id]);
  return setEl;
}
