// Domain helpers for the discovery crawler.

/** Hostname without a leading "www.", lowercased. Used as the dedupe key. */
export function registrableDomain(url: string): string | null {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Aggregators, socials, directories, and ticketing — we want a venue's OWN
// site/newsletter, not these. Candidates on these domains are skipped.
const SKIP_DOMAINS = new Set([
  "eventbrite.com",
  "dice.fm",
  "partiful.com",
  "facebook.com",
  "m.facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "yelp.com",
  "tripadvisor.com",
  "google.com",
  "maps.google.com",
  "goldstar.com",
  "ticketmaster.com",
  "axs.com",
  "seetickets.us",
  "songkick.com",
  "bandsintown.com",
  "meetup.com",
  "reddit.com",
  "youtube.com",
  "wikipedia.org",
  "timeout.com",
  "thrillist.com",
  "laist.com",
  "discotech.me",
  "do213.com",
  "wheretraveler.com",
  "allevents.in",
  "patch.com",
  "foursquare.com",
  "linktr.ee",
]);

export function isSkippableDomain(domain: string): boolean {
  if (SKIP_DOMAINS.has(domain)) return true;
  // Also skip obvious non-venue infra.
  if (/\.(gov|edu)$/.test(domain)) return true;
  return false;
}
