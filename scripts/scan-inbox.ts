// Scan one Google account for places and sources Light Pole should be watching.
//
//   npm run scan:inbox                    # last 180 days of mail + calendar
//   npm run scan:inbox -- --days 365      # look further back
//   npm run scan:inbox -- --no-calendar   # mail only
//   npm run scan:inbox -- --anthropic     # use Claude instead of the local Ollama model
//
// Opens a private browser window to sign in (pick any Google account), then:
//   - Inbox: reads only sender / subject / date of newsletter-type mail (anything with
//     "unsubscribe"), groups it by sender, has the LLM sort out which senders are LA event
//     sources (venues, curators like KCRW, promoters, ticketing), and reads the newest issue
//     from each of those to note what it covers. No other message bodies are fetched.
//   - Calendar: events from 90 days back to 90 ahead that look public (not appointments),
//     checked against Light Pole's listings, so misses show which sources we lack.
// Nothing is kept from the sign-in: the access token lives in memory for this run only.
// The report leads with "places to track": venues, series and promoters, where each posts
// its schedule, and which newsletter/calendar entry surfaced it, marked new vs on Light Pole.
// Results go to inbox-scans/<account>__<date_time>.json and .md (gitignored: personal data).
//
// One-time setup: a Google OAuth client of type "Desktop app" with the Gmail and Calendar
// APIs enabled; put GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local.

import "./env";

import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { supabase } from "../lib/supabase";
import { complete, defaultProvider, extractJson } from "../lib/llm";
import { htmlToText } from "../lib/scrape";
import { registrableDomain } from "../lib/domain";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) || dflt : dflt;
};
const DAYS = opt("days", 180);
const MAX_MESSAGES = opt("max-messages", 4000);
const MAX_DETAILS = opt("max-details", 80);
const TZ = "America/Los_Angeles";
// --anthropic sends sender names, subjects and newest issues to Claude; the default (ollama) stays on this computer.
const PROVIDER = flag("anthropic") ? "anthropic" : defaultProvider();
const MODEL = PROVIDER === "ollama"
  ? `ollama:${process.env.OLLAMA_MODEL || "llama3.1"}`
  : `anthropic:${process.env.EXTRACTION_MODEL || "claude-haiku-5-5"}`;

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

// ---------- sign-in (OAuth loopback + PKCE) ----------

function openBrowser(url: string) {
  const zen = spawnSync("flatpak", ["info", "app.zen_browser.zen"], { stdio: "ignore" }).status === 0;
  const [cmd, cmdArgs] = zen
    ? ["flatpak", ["run", "app.zen_browser.zen", "--private-window", url]]
    : ["xdg-open", [url]];
  spawn(cmd, cmdArgs as string[], { detached: true, stdio: "ignore" }).unref();
}

async function signIn(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET in .env.local (see docs/discovery-strategy/INBOX-SCAN.md).");
    process.exit(1);
  }
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url ?? "/", redirect);
      const c = u.searchParams.get("code");
      if (!c && !u.searchParams.get("error")) { res.writeHead(404).end(); return; }
      const ok = c && u.searchParams.get("state") === state;
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<body style="font:16px system-ui;padding:3em">${ok ? "Signed in. The scan is running in your terminal; you can close this window." : "Sign-in failed. Check the terminal."}</body>`,
      );
      if (ok) resolve(c!);
      else reject(new Error(u.searchParams.get("error") ?? "state mismatch"));
    });
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "),
      code_challenge: challenge, code_challenge_method: "S256", state, prompt: "select_account consent",
    }).toString();
    console.log(`\nOpening a private window to sign in. If nothing opens, paste this into a private window:\n\n${auth}\n`);
    openBrowser(auth.toString());
  });
  server.close();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect,
      grant_type: "authorization_code", code_verifier: verifier,
    }),
  });
  const tok = (await res.json()) as { access_token?: string; error_description?: string };
  if (!tok.access_token) throw new Error(`token exchange failed: ${tok.error_description ?? res.status}`);
  return tok.access_token;
}

// ---------- Google API helpers ----------

let TOKEN = "";
async function g<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${res.status} ${url.split("?")[0]}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
type Header = { name: string; value: string };
interface GPart { mimeType?: string; body?: { data?: string }; parts?: GPart[]; headers?: Header[] }
interface GMessage { id: string; internalDate: string; payload: GPart }

function bodyText(p: GPart): string {
  const find = (part: GPart, type: string): string | null => {
    if (part.mimeType === type && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
    for (const c of part.parts ?? []) { const t = find(c, type); if (t) return t; }
    return null;
  };
  const html = find(p, "text/html");
  return (html ? htmlToText(html) : find(p, "text/plain") ?? "").replace(/\s+/g, " ").trim();
}

function parseFrom(v: string): { name: string; address: string } {
  const m = v.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim(), address: m[2].trim().toLowerCase() } : { name: "", address: v.trim().toLowerCase() };
}

const squash = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const laDay = (d: Date | string | number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(d));

async function askJson<T>(system: string, prompt: string): Promise<T | null> {
  try {
    return JSON.parse(extractJson(await complete({ system, prompt, json: true, maxTokens: 3000, temperature: 0, provider: PROVIDER }))) as T;
  } catch (e) {
    console.warn(`  LLM reply unusable: ${(e as Error).message}`);
    return null;
  }
}

// ---------- inbox ----------

interface Sender {
  address: string;
  name: string;
  domain: string | null;
  list_id: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
  per_month: number;
  sample_subjects: string[];
  latest_id: string;
  kind?: string;
  la_relevant?: boolean | null;
  details?: unknown;
  already_in_light_pole?: string | null;
}

async function scanInbox() {
  const q = `newer_than:${DAYS}d unsubscribe -in:sent -in:chats`;
  const ids: string[] = [];
  let page: string | undefined;
  do {
    const r = await g<{ messages?: { id: string }[]; nextPageToken?: string }>(
      `${GM}/messages?maxResults=500&q=${encodeURIComponent(q)}${page ? `&pageToken=${page}` : ""}`,
    );
    ids.push(...(r.messages ?? []).map((m) => m.id));
    page = r.nextPageToken;
  } while (page && ids.length < MAX_MESSAGES);
  console.log(`Inbox: ${ids.length} newsletter-type messages in the last ${DAYS} days. Reading headers…`);

  const metaUrl = (id: string) =>
    `${GM}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Id`;
  const metas = await mapLimit(ids.slice(0, MAX_MESSAGES), 8, (id) => g<GMessage>(metaUrl(id)).catch(() => null));

  const senders = new Map<string, Sender & { subjects: string[]; times: number[] }>();
  for (const m of metas) {
    if (!m) continue;
    const h = (n: string) => m.payload.headers?.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
    const from = parseFrom(h("From"));
    if (!from.address.includes("@")) continue;
    const t = Number(m.internalDate);
    let s = senders.get(from.address);
    if (!s) {
      s = {
        address: from.address, name: from.name,
        domain: registrableDomain(`https://${from.address.split("@")[1]}`),
        list_id: h("List-Id") || null, count: 0, first_seen: "", last_seen: "", per_month: 0,
        sample_subjects: [], latest_id: m.id, subjects: [], times: [],
      };
      senders.set(from.address, s);
    }
    s.count++;
    s.times.push(t);
    s.subjects.push(h("Subject"));
    if (t >= Math.max(...s.times)) s.latest_id = m.id;
  }

  const list: Sender[] = [...senders.values()].map(({ subjects, times, ...s }) => {
    const order = times.map((t, i) => [t, subjects[i]] as const).sort((a, b) => b[0] - a[0]);
    const span = Math.max(1, (order[0][0] - order[order.length - 1][0]) / (30 * 86400000));
    return {
      ...s,
      first_seen: laDay(order[order.length - 1][0]),
      last_seen: laDay(order[0][0]),
      per_month: Math.round((s.count / Math.max(span, Math.min(DAYS / 30, 1))) * 10) / 10,
      sample_subjects: [...new Set(order.map(([, sub]) => sub))].slice(0, 6),
    };
  }).sort((a, b) => b.count - a.count);
  console.log(`${list.length} senders. Sorting out which ones are event sources…`);

  // Pass 1: sender + subjects only.
  const SYSTEM1 =
    "You sort email senders for an LA events listings site. For each sender decide what it is from its name, address and recent subject lines. " +
    'kind: "venue" (a bar, club, theater, museum, gallery, brewery, bookstore… sending its own schedule), "curator" (newsletters/radio/media that round up events, e.g. KCRW, LA Taco), ' +
    '"promoter" (a party/series/collective), "ticketing" (Eventbrite, DICE, RA, AXS, Ticketmaster, Partiful…), or "not_events" (shopping, banks, software, politics, news with no events). ' +
    "la_relevant: true if it is in or about Los Angeles / Southern California, false if clearly elsewhere, null if unknown. " +
    'Reply with JSON only: {"senders":[{"i":0,"kind":"…","la_relevant":true,"name":"clean organization name"}]}';
  const BATCH = 15;
  for (let b = 0; b < list.length; b += BATCH) {
    const chunk = list.slice(b, b + BATCH);
    const prompt = chunk.map((s, i) => `${i}. ${s.name} <${s.address}> (${s.count} emails)\n   ${s.sample_subjects.slice(0, 4).join(" | ")}`).join("\n");
    const r = await askJson<{ senders?: { i: number; kind: string; la_relevant: boolean | null; name?: string }[] }>(SYSTEM1, prompt);
    for (const x of r?.senders ?? []) {
      const s = chunk[x.i];
      if (!s) continue;
      s.kind = x.kind;
      s.la_relevant = x.la_relevant;
      if (x.name) s.name = x.name;
    }
    process.stdout.write(`  ${Math.min(b + BATCH, list.length)}/${list.length}\r`);
  }
  console.log();

  // Pass 2: read the newest issue from each likely event source.
  const candidates = list
    .filter((s) => s.kind && s.kind !== "not_events" && s.la_relevant !== false)
    .slice(0, MAX_DETAILS);
  console.log(`${candidates.length} likely event sources. Reading the newest issue from each…`);
  // The goal is ongoing sources to watch, not this issue's events: who sends it, where they
  // post their schedule, and (for curators) which venues and series they point people to.
  const SYSTEM2 =
    "You read one newsletter issue for an LA events listings site that is looking for ongoing event sources to watch (venues, series, promoters, curators). " +
    "Reply with JSON only: " +
    '{"organization":"","type":"venue|curator|promoter|ticketing|other","areas":["LA neighborhoods or cities"],' +
    '"website":"","calendar_url":"page listing their upcoming events, if linked","instagram":"handle if shown","ticketing":"platform they sell through, if any",' +
    '"cadence":"how often they put on events, e.g. weekly, monthly, nightly",' +
    '"venues_mentioned":[{"name":"","area":"","what":"kind of events there"}],' +
    '"recurring_series":[{"name":"","venue":"","when":"e.g. every Tuesday"}],' +
    '"underground_or_hard_to_find":true,"worth_watching":true,"why":"one short sentence"}. ' +
    "venues_mentioned matters most for curators: list every LA venue, bar, gallery or space the issue names (up to 20). Use empty strings or [] when unknown. Do not invent anything not in the text.";
  await mapLimit(candidates, 2, async (s) => {
    try {
      const m = await g<GMessage>(`${GM}/messages/${s.latest_id}?format=full`);
      const text = bodyText(m.payload).slice(0, 7000);
      s.details = await askJson(SYSTEM2, `From: ${s.name} <${s.address}>\nSubject: ${s.sample_subjects[0] ?? ""}\n\n${text}`);
    } catch (e) {
      s.details = { error: (e as Error).message };
    }
  });

  // Already a source? (newsletter mapping, or the sender is a venue we list)
  const [{ data: sources }, { data: venues }] = await Promise.all([
    supabase.from("newsletter_sources").select("from_address, from_domain, active"),
    supabase.from("venues").select("name, website"),
  ]);
  const venueDomains = new Map<string, string>();
  for (const v of venues ?? []) { const d = v.website ? registrableDomain(v.website) : null; if (d) venueDomains.set(d, v.name); }
  const venueNames = new Map((venues ?? []).filter((v) => squash(v.name).length >= 5).map((v) => [squash(v.name), v.name] as const));
  for (const s of list) {
    const src = (sources ?? []).find((x) => x.active !== false && (x.from_address === s.address || (s.domain && x.from_domain === s.domain)));
    s.already_in_light_pole = src
      ? "newsletter source"
      : s.domain && venueDomains.has(s.domain)
        ? `venue website (${venueDomains.get(s.domain)})`
        : venueNames.has(squash(s.name))
          ? `venue name (${venueNames.get(squash(s.name))})`
          : null;
  }

  return { messages_scanned: metas.filter(Boolean).length, senders_total: list.length, sources: list };
}

// ---------- calendar ----------

interface CalItem { summary?: string; location?: string; description?: string; start?: { dateTime?: string; date?: string }; organizer?: { email?: string; displayName?: string }; htmlLink?: string; status?: string }

async function scanCalendar() {
  const now = Date.now();
  const timeMin = new Date(now - 90 * 86400000).toISOString();
  const timeMax = new Date(now + 90 * 86400000).toISOString();
  const cals = await g<{ items: { id: string; summary: string; selected?: boolean }[] }>(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
  );
  const skip = /#holiday@|#contacts@|#weather@/;
  const items: (CalItem & { calendar: string })[] = [];
  for (const c of cals.items.filter((c) => !skip.test(c.id))) {
    let page: string | undefined;
    do {
      const r = await g<{ items: CalItem[]; nextPageToken?: string }>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${timeMin}&timeMax=${timeMax}${page ? `&pageToken=${page}` : ""}`,
      ).catch(() => ({ items: [] as CalItem[], nextPageToken: undefined }));
      items.push(...r.items.filter((e) => e.status !== "cancelled" && e.summary).map((e) => ({ ...e, calendar: c.summary })));
      page = r.nextPageToken;
    } while (page);
  }
  console.log(`Calendar: ${items.length} entries in ${cals.items.length} calendars. Picking out public events…`);

  const SYSTEM =
    "You look at calendar entries and decide which are public events someone could find listed (concerts, club nights, shows, screenings, markets, festivals, talks, sports games, art openings, classes open to the public). " +
    "Personal items are not public: appointments, work meetings, birthdays, dinners with friends, travel, reminders, private parties. " +
    'Reply with JSON only: {"items":[{"i":0,"public":true}]}';
  const pub: typeof items = [];
  for (let b = 0; b < items.length; b += 25) {
    const chunk = items.slice(b, b + 25);
    const prompt = chunk.map((e, i) => `${i}. ${e.summary}${e.location ? ` @ ${e.location}` : ""}${e.organizer?.email ? ` (organizer ${e.organizer.email})` : ""}`).join("\n");
    const r = await askJson<{ items?: { i: number; public: boolean }[] }>(SYSTEM, prompt);
    for (const x of r?.items ?? []) if (x.public && chunk[x.i]) pub.push(chunk[x.i]);
  }

  // Light Pole listings across the same window, by LA day.
  const byDay = new Map<string, { title: string; venue: string }[]>();
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("event_occurrences")
      .select("starts_at, event:events(title, venue:venues(name))")
      .gte("starts_at", timeMin).lte("starts_at", timeMax)
      .range(from, from + 999);
    for (const o of (data ?? []) as unknown as { starts_at: string; event: { title: string; venue: { name: string } | null } | null }[]) {
      if (!o.event) continue;
      const k = laDay(o.starts_at);
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ title: o.event.title, venue: o.event.venue?.name ?? "" });
    }
    if (!data || data.length < 1000) break;
  }

  const matches = (e: CalItem) => {
    const day = laDay(e.start?.dateTime ?? `${e.start?.date}T20:00:00Z`);
    const t = squash(e.summary ?? "");
    const loc = squash(e.location ?? "");
    return (byDay.get(day) ?? []).find((x) => {
      const xt = squash(x.title), xv = squash(x.venue);
      const titleHit = t.length >= 5 && xt.length >= 5 && (t.includes(xt) || xt.includes(t));
      const venueHit = xv.length >= 5 && loc.includes(xv);
      return titleHit || (venueHit && t.length >= 5 && (xt.includes(t.slice(0, 8)) || t.includes(xt.slice(0, 8))));
    });
  };
  // Calendar invites carry Google/Meet/Zoom links and our own site: those aren't event platforms.
  const NOT_PLATFORMS = /^(g\.co|google\.com|gmail\.com|goo\.gl|zoom\.us|somedude\.app)$/;
  const linkDomains = (s?: string) =>
    [...new Set([...(s ?? "").matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => registrableDomain(m[0])).filter((d): d is string => !!d && !NOT_PLATFORMS.test(d)))].slice(0, 4);

  const missing = [], found = [];
  for (const e of pub) {
    const row = {
      title: e.summary, when: e.start?.dateTime ?? e.start?.date, location: e.location ?? null,
      calendar: e.calendar, organizer: e.organizer?.email ?? null, link_domains: linkDomains(e.description),
    };
    const hit = matches(e);
    if (hit) found.push({ ...row, matched: `${hit.title} @ ${hit.venue}` });
    else missing.push(row);
  }
  return { entries_checked: items.length, public_events: pub.length, found_on_light_pole: found, missing_from_light_pole: missing };
}

// ---------- places to track ----------

interface Place {
  name: string;
  area: string;
  kind: string;
  where_to_watch: string[];
  seen_in: string[];
  on_light_pole: string | null;
}

interface Details {
  website?: string; calendar_url?: string; instagram?: string; ticketing?: string; cadence?: string; areas?: string[]; why?: string;
  venues_mentioned?: { name: string; area?: string; what?: string }[];
  recurring_series?: { name: string; venue?: string; when?: string }[];
}

async function placesToTrack(inbox: Awaited<ReturnType<typeof scanInbox>>, calendar: Awaited<ReturnType<typeof scanCalendar>> | null) {
  const { data: venues } = await supabase.from("venues").select("name");
  const known = (venues ?? []).map((v) => ({ key: squash(v.name), name: v.name })).filter((v) => v.key.length >= 5);
  const onLP = (name: string) => {
    const k = squash(name);
    if (k.length < 5) return null;
    return known.find((v) => v.key === k || v.key.includes(k) || k.includes(v.key))?.name ?? null;
  };

  const places = new Map<string, Place>();
  const add = (name: string, p: Partial<Place> & { seen: string }) => {
    const k = squash(name);
    if (k.length < 3) return;
    const cur: Place = places.get(k) ?? { name, area: "", kind: "", where_to_watch: [], seen_in: [], on_light_pole: onLP(name) };
    if (!cur.area && p.area) cur.area = p.area;
    if (!cur.kind && p.kind) cur.kind = p.kind;
    for (const w of p.where_to_watch ?? []) if (w && !cur.where_to_watch.includes(w)) cur.where_to_watch.push(w);
    if (!cur.seen_in.includes(p.seen)) cur.seen_in.push(p.seen);
    places.set(k, cur);
  };

  for (const s of inbox.sources) {
    if (!s.kind || s.kind === "not_events" || s.la_relevant === false) continue;
    const d = (s.details ?? {}) as Details;
    if (s.kind === "venue" || s.kind === "promoter") {
      add(s.name, {
        kind: s.kind, area: (d.areas ?? []).join(", "), seen: "their newsletter",
        where_to_watch: [`newsletter: ${s.address}`, d.calendar_url, d.website, d.instagram && `IG ${d.instagram}`, d.ticketing && `sells on ${d.ticketing}`, d.cadence && `runs ${d.cadence}`].filter(Boolean) as string[],
      });
    }
    for (const v of d.venues_mentioned ?? []) {
      if (v.name) add(v.name, { kind: "venue", area: v.area, seen: `mentioned by ${s.name}`, where_to_watch: v.what ? [`hosts: ${v.what}`] : [] });
    }
    for (const r of d.recurring_series ?? []) {
      if (r.name) add(r.name, { kind: "series", seen: `mentioned by ${s.name}`, where_to_watch: [[r.venue && `at ${r.venue}`, r.when].filter(Boolean).join(", ")].filter(Boolean) });
    }
  }

  for (const e of calendar?.missing_from_light_pole ?? []) {
    const place = (e.location ?? "").split(",")[0].trim();
    if (place && !/^\d/.test(place)) {
      add(place, {
        kind: "venue", seen: `your calendar: ${e.title}`,
        where_to_watch: [...e.link_domains.map((d) => `listed on ${d}`), e.organizer && !e.organizer.endsWith("gmail.com") ? `organizer ${e.organizer}` : ""].filter(Boolean) as string[],
      });
    }
  }

  // New places first, then the ones that came up most often.
  return [...places.values()].sort((a, b) => Number(!!a.on_light_pole) - Number(!!b.on_light_pole) || b.seen_in.length - a.seen_in.length);
}

// ---------- report ----------

function markdown(r: { account: string; scanned_at: string; model: string; places: Place[]; inbox: Awaited<ReturnType<typeof scanInbox>>; calendar: Awaited<ReturnType<typeof scanCalendar>> | null }) {
  const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
  const newPlaces = r.places.filter((p) => !p.on_light_pole);
  const ev = r.inbox.sources.filter((s) => s.kind && s.kind !== "not_events" && s.la_relevant !== false);
  const fresh = ev.filter((s) => !s.already_in_light_pole);
  const lines = [
    `# Inbox scan: ${r.account}`,
    "",
    `Scanned ${r.scanned_at} (LA time) · model ${r.model} · last ${DAYS} days · ${r.inbox.messages_scanned} newsletter-type emails from ${r.inbox.senders_total} senders`,
    "",
    `## Places to track, not on Light Pole yet (${newPlaces.length})`,
    "",
    "| Place | Kind | Area | Where to watch | Came up in |",
    "|---|---|---|---|---|",
    ...newPlaces.map((p) => `| **${esc(p.name)}** | ${esc(p.kind)} | ${esc(p.area)} | ${esc(p.where_to_watch.join("<br>"))} | ${esc(p.seen_in.slice(0, 4).join("<br>"))} |`),
    "",
    `Already on Light Pole: ${r.places.length - newPlaces.length} of ${r.places.length} places.`,
    "",
    `## Newsletters worth subscribing the Light Pole inbox to (${fresh.length})`,
    "",
    "| Sender | Kind | Emails/mo | Areas | Why |",
    "|---|---|---|---|---|",
    ...fresh.map((s) => {
      const d = (s.details ?? {}) as Details;
      return `| **${esc(s.name)}**<br>${esc(s.address)} | ${esc(s.kind)} | ${s.per_month} | ${esc((d.areas ?? []).join(", "))} | ${esc(d.why)} |`;
    }),
    "",
    `## Already in Light Pole (${ev.length - fresh.length})`,
    "",
    ...ev.filter((s) => s.already_in_light_pole).map((s) => `- ${esc(s.name)} <${s.address}>: ${s.already_in_light_pole}`),
  ];
  if (r.calendar) {
    const c = r.calendar;
    lines.push(
      "",
      `## Calendar: public events missing from Light Pole (${c.missing_from_light_pole.length} of ${c.public_events})`,
      "",
      "| When | Event | Where | Hints (organizer, links) |",
      "|---|---|---|---|",
      ...c.missing_from_light_pole.map((e) => `| ${esc(e.when?.slice(0, 16).replace("T", " "))} | ${esc(e.title)} | ${esc(e.location)} | ${esc([e.organizer, ...e.link_domains].filter(Boolean).join(", "))} |`),
      "",
      `Found on Light Pole: ${c.found_on_light_pole.length}`,
    );
  }
  return lines.join("\n") + "\n";
}

async function main() {
  // Check the LLM before asking anyone to sign in.
  try {
    await complete({ system: "Reply with JSON only.", prompt: '{"ok":true}', json: true, maxTokens: 20, provider: PROVIDER });
  } catch (e) {
    console.error(`The LLM (${MODEL}) isn't working: ${(e as Error).message.slice(0, 300)}\nFix Ollama, or run with --anthropic (needs ANTHROPIC_API_KEY in .env.local).`);
    process.exit(1);
  }

  TOKEN = await signIn();
  const profile = await g<{ emailAddress: string }>(`${GM}/profile`);
  const account = profile.emailAddress.toLowerCase();
  console.log(`Signed in as ${account}.`);

  const model = MODEL;
  const inbox = await scanInbox();
  const calendar = flag("no-calendar") ? null : await scanCalendar().catch((e) => {
    console.warn(`Calendar skipped: ${(e as Error).message}`);
    return null;
  });

  const places = await placesToTrack(inbox, calendar);

  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const base = `inbox-scans/${account}__${stamp.replace(" ", "_").replace(":", "-")}`;
  const report = { account, scanned_at: stamp, model, window_days: DAYS, places, inbox, calendar };
  mkdirSync("inbox-scans", { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, markdown(report));
  console.log(`\nWrote ${base}.md and .json`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
