// The weekly email ("your week on the pole"): shared bits for the signup routes and the
// weekly send (scripts/weekly-email.ts).

// Sender for the weekly email and its confirmation (somedude.app is the verified Resend domain).
export const WEEKLY_FROM = process.env.WEEKLY_EMAIL_FROM || "Miguel at Light Pole <miguel@somedude.app>";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://afoot.somedude.app";
export const TYPE_KEYS = ["music", "comedy", "class", "art", "games", "market", "food"];
export const TYPE_LABELS: Record<string, string> = {
  music: "music", comedy: "comedy", class: "classes", art: "art", games: "games", market: "markets", food: "food",
};

// Web Crypto, so this file also loads in the browser (the signup sheet uses filterLine).
export const newToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const confirmUrl = (t: string) => `${SITE_URL}/api/newsletter/confirm?t=${encodeURIComponent(t)}`;
export const unsubscribeUrl = (t: string) => `${SITE_URL}/api/newsletter/unsubscribe?t=${encodeURIComponent(t)}`;

/** "music + comedy around Echo Park", "everything around LA". */
export function filterLine(place: string, types: string[]): string {
  const what = types.length ? types.map((t) => TYPE_LABELS[t] ?? t).join(" + ") : "everything";
  return `${what} around ${place === "All of LA" ? "LA" : place}`;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
