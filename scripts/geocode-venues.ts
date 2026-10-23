// Fill in lat/lng for any venue that has an address but no coordinates.
// Run:  npm run geocode

import "./env";

import { supabase } from "../lib/supabase";
import { geocode } from "../lib/geocode";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, address, city, lat, lng")
    .is("lat", null);
  if (error) throw error;

  if (!venues?.length) {
    console.log("All venues already have coordinates.");
    return;
  }

  for (const v of venues) {
    const query = v.address || (v.name && v.city ? `${v.name}, ${v.city}` : null);
    if (!query) {
      console.log(`- ${v.name}: no address to geocode, skipping`);
      continue;
    }

    const geo = await geocode(query);
    if (!geo) {
      console.log(`- ${v.name}: no geocode match for "${query}"`);
    } else {
      await supabase.from("venues").update({ lat: geo.lat, lng: geo.lng }).eq("id", v.id);
      console.log(`+ ${v.name}: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`);
    }
    await sleep(1100); // Nominatim: <= 1 req/sec
  }
  console.log("Done.");
}

main().then(() => process.exit(0));
