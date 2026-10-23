// Fill venue_lat / venue_lng in a local events CSV (Nominatim, 1 request/second).
//   npm run geocode:csv                       # uses LOCAL_EVENTS_FILE
//   npm run geocode:csv -- data/other.csv

import "./env";

import fs from "node:fs";
import { geocode } from "../lib/geocode";
import { parseCsv, toCsv } from "../lib/localEvents";

const COLUMNS = [
  "title", "description", "category", "price", "starts_at", "ends_at", "is_recurring",
  "recurrence_description", "tags", "venue_name", "venue_address", "neighborhood",
  "venue_lat", "venue_lng", "url", "source_url", "confidence", "notes",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = process.argv[2] || process.env.LOCAL_EVENTS_FILE;
  if (!file) throw new Error("Pass a CSV path or set LOCAL_EVENTS_FILE in .env.local");
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const cache = new Map<string, { lat: number; lng: number } | null>();
  let filled = 0;
  const missing: string[] = [];

  for (const row of rows) {
    if (row.venue_lat && row.venue_lng) continue;
    const address = row.venue_address || `${row.venue_name}, ${row.neighborhood}, Los Angeles, CA`;
    if (!cache.has(address)) {
      // A result outside the address's ZIP is a different street with the same name
      // ("107 4th St" matched Manhattan Beach instead of downtown LA), so reject it.
      const zip = address.match(/\b(9\d{4})\b/)?.[1];
      const lookup = async (q: string) => {
        const g = await geocode(q);
        await sleep(1100);
        return g && (!zip || g.label.includes(zip)) ? g : null;
      };
      // Nominatim doesn't understand suite/unit numbers; then fall back to the venue name.
      let geo = await lookup(address);
      const street = address.replace(/,?\s*(suite|ste\.?|unit|#)\s*[\w-]+/i, "");
      if (!geo && street !== address) geo = await lookup(street);
      if (!geo && row.venue_name) geo = await lookup(`${row.venue_name}, ${row.neighborhood || "Los Angeles"}, CA${zip ? ` ${zip}` : ""}`);
      cache.set(address, geo ? { lat: geo.lat, lng: geo.lng } : null);
    }
    const hit = cache.get(address);
    if (hit) {
      row.venue_lat = hit.lat.toFixed(6);
      row.venue_lng = hit.lng.toFixed(6);
      filled++;
    } else missing.push(`${row.venue_name} — ${address}`);
  }

  fs.writeFileSync(file, toCsv(rows, COLUMNS));
  console.log(`Geocoded ${filled} row(s) in ${file}.`);
  if (missing.length) console.log(`Couldn't place ${missing.length}:\n  ${[...new Set(missing)].join("\n  ")}`);
}

main().then(() => process.exit(0));
