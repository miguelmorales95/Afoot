"use client";

// Counts for the traffic ranking: an event card "view" (at least half on screen, once per page
// view) and a "click" (tap through to the event's page). Ids are batched in memory and sent
// together with navigator.sendBeacon (every few seconds of activity, and when the page is
// hidden), so each phone makes one small request per batch. Only event ids are sent.
const URL = "/api/events/seen";
const MAX = 100;               // the endpoint ignores bigger batches
const seen = new Set<string>(); // this page view
const clicked = new Set<string>();
let views: string[] = [];
let clicks: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  while (views.length || clicks.length) {
    const body = JSON.stringify({ v: views.splice(0, MAX), c: clicks.splice(0, MAX) });
    const sent = navigator.sendBeacon?.(URL, new Blob([body], { type: "text/plain" }));
    if (!sent) void fetch(URL, { method: "POST", body, keepalive: true }).catch(() => {});
  }
}

function schedule() {
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener("pagehide", flush);
  }
  timer ??= setTimeout(flush, 10000);
}

export function countClick(eventId: string) {
  if (clicked.has(eventId)) return;
  clicked.add(eventId);
  clicks.push(eventId);
  flush(); // the tap opens another tab; send now
}

/** Watch an event card; it counts as viewed the first time >= 50% of it is on screen. */
export function observeEventView(el: Element, eventId: string): () => void {
  if (seen.has(eventId) || typeof IntersectionObserver === "undefined") return () => {};
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) {
      io.disconnect();
      if (seen.has(eventId)) return;
      seen.add(eventId);
      views.push(eventId);
      schedule();
    }
  }, { threshold: 0.5 });
  io.observe(el);
  return () => io.disconnect();
}
