// Reading one event from a link someone pasted on /submit. In order:
//   1. Eventbrite's or Ticketmaster's official API, when the key is set and the link is theirs;
//   2. the event data most event pages carry for search engines (schema.org JSON-LD);
//   3. the page's preview tags (og:title, og:description) plus the AI, as a last resort.
// Facebook usually shows logged-out visitors only a sign-in page, so for Facebook links the
// details the submitter typed in matter most. Nothing goes live until an admin approves it.
import { eventbriteEventFromUrl, ticketmasterEventFromUrl, type LinkedEvent } from "./eventApis";
import { extractEvents } from "./extract";
import { todayISODate } from "./ingest";
import { fetchPublicHtml } from "./safeFetch";
import { htmlToText } from "./scrape";
import type { EventCategory } from "./types";

export type LinkSource = "facebook" | "eventbrite" | "ticketmaster" | "meetup" | "other";

export function linkSource(url: string): LinkSource {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (/(^|\.)(facebook\.com|fb\.me|fb\.com)$/.test(host)) return "facebook";
  if (/(^|\.)eventbrite\./.test(host)) return "eventbrite";
  if (/(^|\.)(ticketmaster|livenation)\.com$/.test(host)) return "ticketmaster";
  if (/(^|\.)meetup\.com$/.test(host)) return "meetup";
  return "other";
}

export type LinkDetails = Partial<LinkedEvent>;

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function guessCategory(text: string): EventCategory {
  const t = text.toLowerCase();
  if (/karaoke/.test(t)) return "karaoke";
  if (/trivia|quiz/.test(t)) return "trivia";
  if (/comedy|stand-?up|improv/.test(t)) return "comedy";
  if (/market|swap|fair|flea/.test(t)) return "market";
  if (/game night|board game|bingo|dnd|d&d/.test(t)) return "games";
  if (/workshop|class|lesson|course/.test(t)) return "class";
  if (/tasting|dinner|brunch|pop-?up|food/.test(t)) return "food";
  if (/concert|live music|band|dj|jazz|open mic/.test(t)) return "music";
  return "other";
}

/** schema.org Event objects anywhere in the page's JSON-LD (including @graph and arrays). */
function jsonLdEvents(html: string): any[] {
  const out: any[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const type = [].concat(node["@type"] ?? []).join(" ");
    if (/Event\b/.test(type) && node.startDate) out.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* a broken block: skip it */ }
  }
  return out;
}

function fromJsonLd(e: any, url: string): LinkDetails {
  const loc = [].concat(e.location ?? [])[0] as any;
  const addr = loc?.address;
  const address = typeof addr === "string" ? addr
    : addr ? [addr.streetAddress, addr.addressLocality, addr.addressRegion]
      .filter((p, i, all) => p && !all.slice(0, i).some((q) => q && String(q).includes(String(p)))).join(", ") : null;
  const offer = [].concat(e.offers ?? [])[0] as any;
  const low = offer?.lowPrice ?? offer?.price;
  const price = offer ? (Number(low) === 0 ? "Free" : low != null ? `$${low}${offer.highPrice && offer.highPrice !== low ? `–${offer.highPrice}` : ""}` : null) : null;
  const title = decode(String(e.name ?? "")).trim();
  const description = e.description ? decode(String(e.description)).replace(/\s+/g, " ").trim().slice(0, 1200) : null;
  return {
    title, description, starts_at: e.startDate, ends_at: e.endDate ?? null, url: e.url || url, price,
    category: guessCategory(`${title} ${description ?? ""}`),
    venue_name: loc?.name ? decode(String(loc.name)) : null, address: address || null,
    lat: loc?.geo?.latitude != null ? Number(loc.geo.latitude) : null, lng: loc?.geo?.longitude != null ? Number(loc.geo.longitude) : null,
  };
}

function metaTags(html: string) {
  const get = (prop: string) => {
    const m = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)
      || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i").exec(html);
    return m ? decode(m[1]).trim() : null;
  };
  return { title: get("og:title"), description: get("og:description") || get("description") };
}

export interface LinkReadResult { source: LinkSource; details: LinkDetails | null; error: string | null }

export async function readEventLink(url: string): Promise<LinkReadResult> {
  const source = linkSource(url);
  try {
    const api = source === "eventbrite" ? await eventbriteEventFromUrl(url).catch(() => null)
      : source === "ticketmaster" ? await ticketmasterEventFromUrl(url).catch(() => null) : null;
    if (api) return { source, details: api, error: null };

    const page = await fetchPublicHtml(url);
    const ld = jsonLdEvents(page.html);
    if (ld.length) return { source, details: fromJsonLd(ld[0], page.url), error: null };

    const meta = metaTags(page.html);
    const loginWall = source === "facebook" && (!meta.title || /log in|facebook$/i.test(meta.title));
    if (loginWall) return { source, details: null, error: "Facebook didn't show this event without signing in" };

    // Last resort: the AI reads the preview text and the page (only when a model is configured).
    if (process.env.ANTHROPIC_API_KEY || process.env.LLM_PROVIDER === "ollama") {
      const text = [meta.title, meta.description, htmlToText(page.html).slice(0, 12000)].filter(Boolean).join("\n");
      const [ev] = await extractEvents({ venueName: meta.title || new URL(page.url).hostname, pageText: text, sourceUrl: page.url, today: todayISODate() });
      if (ev?.occurrences?.[0]) {
        return { source, details: {
          title: ev.title, description: ev.description, starts_at: ev.occurrences[0].start, ends_at: ev.occurrences[0].end,
          url: page.url, price: ev.price, category: ev.category, venue_name: null, address: null, lat: null, lng: null,
        }, error: null };
      }
    }
    return { source, details: meta.title ? { title: meta.title, description: meta.description, url: page.url } : null, error: "No date found on the page" };
  } catch (e) {
    return { source, details: null, error: (e as Error).message };
  }
}

/** "2026-11-07T20:00" typed in Los Angeles → an ISO time with the right offset (PST or PDT). */
export function laLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // The offset LA had at that moment: format the UTC instant in LA time and compare.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(asUtc)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {} as Record<string, string>);
  const laAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(asUtc + (asUtc - laAsUtc)).toISOString();
}
