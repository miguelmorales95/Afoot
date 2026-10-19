// Discovery crawler: search the web for likely LA venues, classify each site
// with an LLM (Claude or local Ollama), and build a database of candidate
// venues + their events/newsletter pages. Approved candidates are promoted to
// real venues (scripts/promote.ts) and then ingested like any other.

import { supabase } from "./supabase";
import { htmlToText } from "./scrape";
import { webSearch, activeSearchBackend } from "./search";
import { complete, extractJson } from "./llm";
import { registrableDomain, isSkippableDomain } from "./domain";
import { buildQueries } from "./discovery-queries";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SiteFetch {
  ok: boolean;
  status: number;
  text: string;
  eventLinks: string[];
  newsletterLinks: string[];
}

/** Pull absolute hrefs that look like event/calendar or newsletter links. */
function extractInterestingLinks(html: string, baseUrl: string) {
  const eventLinks = new Set<string>();
  const newsletterLinks = new Set<string>();
  const re = /<a[^>]+href="([^"#]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = m[1];
    try {
      href = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    const lower = href.toLowerCase();
    if (/(event|calendar|shows?|whats-?on|lineup|schedule|happenings)/.test(lower))
      eventLinks.add(href);
    if (/(newsletter|subscribe|signup|sign-up|mailing|mailchimp|substack|list-manage)/.test(lower))
      newsletterLinks.add(href);
  }
  return {
    eventLinks: [...eventLinks].slice(0, 10),
    newsletterLinks: [...newsletterLinks].slice(0, 5),
  };
}

async function fetchSite(url: string): Promise<SiteFetch> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const html = await res.text();
    const { eventLinks, newsletterLinks } = extractInterestingLinks(html, url);
    return {
      ok: res.ok,
      status: res.status,
      text: htmlToText(html).slice(0, 12000),
      eventLinks,
      newsletterLinks,
    };
  } catch {
    return { ok: false, status: 0, text: "", eventLinks: [], newsletterLinks: [] };
  }
}

export interface Classification {
  is_candidate: boolean;
  confidence: number;
  venue_name: string | null;
  venue_type: string | null;
  neighborhood: string | null;
  city: string | null;
  address: string | null;
  in_la: boolean;
  has_events: boolean;
  events_url: string | null;
  newsletter_url: string | null;
  categories: string[];
  reason: string;
}

const CLASSIFY_SYSTEM = `You decide whether a website belongs to a SPECIFIC, PHYSICAL venue in the
Greater Los Angeles area that hosts small, recurring community events — the kind worth tracking:
karaoke, trivia, board/tabletop game nights, open mics, live music, DJ nights, comedy, markets,
craft/paint nights, book clubs, run clubs, etc. Good venues: bars, breweries, cafes, coffee shops,
restaurants, music venues, bookstores, record shops, art spaces, community spaces.

REJECT (is_candidate=false): event aggregators/ticketing (Eventbrite, Dice, etc.), social media,
directories, blogs/news/"best of" lists, chains with no local events, pure retail/offices, venues
clearly OUTSIDE the LA metro, and personal/portfolio sites.

You are given the site URL, its text, and lists of links on the page that look like event or
newsletter pages. Choose the best events_url and newsletter_url from those links (or null).

Respond with ONLY this JSON object:
{
  "is_candidate": boolean,
  "confidence": number,            // 0..1 that this is a trackable LA venue with events
  "venue_name": string | null,
  "venue_type": string | null,     // e.g. "brewery", "dive bar", "cafe", "music venue"
  "neighborhood": string | null,
  "city": string | null,
  "address": string | null,        // street address if present, else null
  "in_la": boolean,                // within Greater LA metro
  "has_events": boolean,           // evidence of recurring/one-off events
  "events_url": string | null,     // absolute URL, chosen from the provided links if possible
  "newsletter_url": string | null, // absolute URL for a newsletter/mailing-list signup
  "categories": string[],          // from: music, karaoke, trivia, games, comedy, market, food, class, other
  "reason": string                 // one short sentence
}`;

export async function classifySite(
  url: string,
  text: string,
  eventLinks: string[],
  newsletterLinks: string[],
): Promise<Classification | null> {
  const prompt = [
    `Site URL: ${url}`,
    `Event-ish links found: ${eventLinks.join(", ") || "(none)"}`,
    `Newsletter-ish links found: ${newsletterLinks.join(", ") || "(none)"}`,
    ``,
    `--- SITE TEXT START ---`,
    text,
    `--- SITE TEXT END ---`,
  ].join("\n");

  const raw = await complete({
    system: CLASSIFY_SYSTEM,
    prompt,
    maxTokens: 1200,
    json: true,
  });
  try {
    return JSON.parse(extractJson(raw)) as Classification;
  } catch {
    return null;
  }
}

export interface DiscoverOptions {
  queryLimit?: number; // how many search queries this run
  perQuery?: number; // hits to take per query
  minConfidence?: number; // store threshold
  maxCandidates?: number; // stop after storing this many
  log?: (s: string) => void;
}

export interface DiscoverSummary {
  queriesRun: number;
  sitesFetched: number;
  stored: number;
  backend: string;
}

/** Load domains we already know (venues + prior candidates) to avoid re-work. */
async function knownDomains(): Promise<Set<string>> {
  const known = new Set<string>();
  const { data: venues } = await supabase.from("venues").select("website");
  for (const v of venues ?? []) {
    const d = v.website ? registrableDomain(v.website) : null;
    if (d) known.add(d);
  }
  const { data: cands } = await supabase.from("candidate_venues").select("domain");
  for (const c of cands ?? []) if (c.domain) known.add(c.domain);
  return known;
}

export async function discover(opts: DiscoverOptions = {}): Promise<DiscoverSummary> {
  const log = opts.log ?? console.log;
  const perQuery = opts.perQuery ?? 8;
  const minConfidence = opts.minConfidence ?? 0.5;
  const maxCandidates = opts.maxCandidates ?? 40;

  const queries = buildQueries(opts.queryLimit ?? 25);
  const known = await knownDomains();
  const seenThisRun = new Set<string>();

  log(`Discovery via ${activeSearchBackend()} — ${queries.length} queries, known domains: ${known.size}`);

  let sitesFetched = 0;
  let stored = 0;

  for (const q of queries) {
    if (stored >= maxCandidates) break;
    log(`\n? ${q}`);
    const hits = await webSearch(q, perQuery);
    await sleep(1200); // be polite to the search backend

    for (const hit of hits) {
      if (stored >= maxCandidates) break;
      const domain = registrableDomain(hit.url);
      if (!domain || isSkippableDomain(domain)) continue;
      if (known.has(domain) || seenThisRun.has(domain)) continue;
      seenThisRun.add(domain);

      const homepage = `https://${domain}`;
      const site = await fetchSite(homepage);
      sitesFetched++;
      if (!site.ok || site.text.length < 150) {
        log(`  - ${domain}: thin/failed fetch, skipping`);
        continue;
      }

      const c = await classifySite(homepage, site.text, site.eventLinks, site.newsletterLinks);
      await sleep(400);
      if (!c) {
        log(`  - ${domain}: classify failed`);
        continue;
      }
      if (!c.is_candidate || !c.in_la || c.confidence < minConfidence) {
        log(`  - ${domain}: rejected (${c.confidence.toFixed(2)}) ${c.reason}`);
        continue;
      }

      const { error } = await supabase.from("candidate_venues").upsert(
        {
          domain,
          url: homepage,
          venue_name: c.venue_name,
          venue_type: c.venue_type,
          neighborhood: c.neighborhood,
          city: c.city,
          address: c.address,
          events_url: c.events_url || site.eventLinks[0] || null,
          newsletter_url: c.newsletter_url || site.newsletterLinks[0] || null,
          categories: c.categories ?? [],
          score: c.confidence,
          reason: c.reason,
          source_query: q,
          status: "new",
        },
        { onConflict: "domain", ignoreDuplicates: true },
      );
      if (error) {
        log(`  ! store failed for ${domain}: ${error.message}`);
      } else {
        known.add(domain);
        stored++;
        log(`  + ${c.venue_name ?? domain} (${c.confidence.toFixed(2)}) — ${c.neighborhood ?? c.city ?? "LA"}`);
      }
    }
  }

  return { queriesRun: queries.length, sitesFetched, stored, backend: activeSearchBackend() };
}
