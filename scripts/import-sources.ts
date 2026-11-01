// Turns the coverage lists in data/sources/*.csv (colleges, libraries, parks, museums, malls…) into
// Afoot sources. See data/sources/README.md for the columns and what's been searched.
//   npm run sources:import -- --dry-run                 # print what would be added (reads only)
//   npm run sources:import                              # every data/sources/*.csv
//   npm run sources:import -- data/sources/colleges.csv
// A row with a verified feed (feed_verified = yes) becomes an event feed: Localist API, iCal,
// CivicPlus calendar RSS or Communico library JSON,
// with the institution as the venue for events without their own map pin. A row with only a
// calendar page goes to the /admin review queue, where approving it lets the daily ingest read
// that page with the AI. Rows already known (same feed, or same site) are skipped.

import "./env";

import fs from "node:fs";
import path from "node:path";
import { supabase } from "../lib/supabase";
import { parseCsv } from "../lib/localEvents";
import { registrableDomain } from "../lib/domain";
import { venueFor } from "../lib/venueMatch";

const DIR = "data/sources";

function feedOf(r: Record<string, string>): { kind: "ics" | "localist" | "civicplus" | "communico"; ref: string } | null {
  let url = (r.feed_url || "").trim();
  if (!url || !/^yes$/i.test(r.feed_verified || "")) return null;
  // Trumba publishes every calendar as both RSS and iCal: take the iCal one.
  if (/trumba\.com\/calendars\/[^/?]+\.rss/i.test(url)) url = url.replace(/\.rss\b/i, ".ics");
  if (/RSSFeed\.aspx\?ModID=58/i.test(url)) return { kind: "civicplus", ref: url };
  if (/\.libnet\.info\b/i.test(url)) return { kind: "communico", ref: new URL(url).origin };
  if (/\.rss\b|\/rss|\/feed\/?$|RSSFeed|wp-json|json/i.test(url)) return null;
  if (/localist/i.test(r.platform) && /\/api\/2\/events/.test(url)) return { kind: "localist", ref: url.replace(/\?.*$/, "") };
  if (/\.ics\b|ical|webcal:|format=ical|text\/calendar|\/ics\b|icalendar/i.test(url) || /ics|trumba|livewhale|libcal|google/i.test(r.platform)) return { kind: "ics", ref: url };
  return null; // RSS and JSON feeds of other kinds aren't read yet: listed as a calendar page instead
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const files = args.filter((a) => !a.startsWith("--"));
  const list = files.length ? files : fs.readdirSync(DIR).filter((f) => f.endsWith(".csv")).map((f) => path.join(DIR, f));

  const { data: feeds } = await supabase.from("event_feeds").select("kind, ref");
  const knownFeeds = new Set((feeds ?? []).map((f) => `${f.kind}|${f.ref}`));
  const known = new Set<string>();
  const { data: venues } = await supabase.from("venues").select("website, events_url");
  for (const v of venues ?? []) for (const u of [v.website, v.events_url]) { const d = u && registrableDomain(u); if (d) known.add(d); }
  const { data: cands } = await supabase.from("candidate_venues").select("domain");
  for (const c of cands ?? []) if (c.domain) known.add(c.domain);

  let addedFeeds = 0, queued = 0, skipped = 0;
  for (const file of list) {
    const rows = parseCsv(fs.readFileSync(file, "utf8")).filter((r) => r.name);
    console.log(`\n# ${file}: ${rows.length} row(s)`);
    for (const r of rows) {
      if (/^no$/i.test(r.public_events || "") || /mostly-internal/i.test(r.public_events || "")) { skipped++; continue; }
      const feed = feedOf(r);
      if (feed) {
        if (knownFeeds.has(`${feed.kind}|${feed.ref}`)) { skipped++; continue; }
        knownFeeds.add(`${feed.kind}|${feed.ref}`);
        console.log(`  + feed  ${feed.kind.padEnd(8)} ${r.name} — ${feed.ref}`);
        addedFeeds++;
        if (dryRun) continue;
        const venue_id = await venueFor({ name: r.name, address: [r.name, r.city, "CA"].filter(Boolean).join(", "), lat: null, lng: null, website: r.website || null, source: "feed" });
        const { error } = await supabase.from("event_feeds").upsert({
          kind: feed.kind, ref: feed.ref, label: r.name.slice(0, 120), venue_id, source_type: r.type || null, active: true,
          options: { public_only: r.type === "university" || r.type === "community-college" || undefined },
        }, { onConflict: "kind,ref" });
        if (error) console.log(`    ! ${error.message}`);
        continue;
      }
      const page = (r.calendar_url || "").trim();
      const domain = page && registrableDomain(page);
      // Big institutions share a domain across departments, so the calendar page's own host counts.
      const key = page ? new URL(page).host.replace(/^www\./, "") : "";
      if (!domain || known.has(key) || (known.has(domain) && key === domain)) { skipped++; continue; }
      known.add(key);
      console.log(`  + page  ${r.name} — ${page}`);
      queued++;
      if (dryRun) continue;
      const { error } = await supabase.from("candidate_venues").upsert({
        domain: key, url: r.website || page, venue_name: r.name, city: r.city || "Los Angeles", events_url: page,
        categories: [], score: 0.85, reason: `Coverage list (${file}, ${r.type}): ${r.platform || "calendar page"}${r.notes ? `. ${r.notes}` : ""}`.slice(0, 500),
        source_query: `sources:${r.type}`, status: "new",
      }, { onConflict: "domain", ignoreDuplicates: true });
      if (error) console.log(`    ! ${error.message}`);
    }
  }
  console.log(`\n${addedFeeds} feed(s) and ${queued} calendar page(s) ${dryRun ? "would be added (dry run: nothing written)" : "added"}; ${skipped} skipped.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
