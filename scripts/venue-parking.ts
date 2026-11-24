// Fill in venue parking from OpenStreetMap: a parking lot or garage (public, or for the venue's
// customers) within about a block of the venue. Only venues with no parking note are touched,
// so anything entered by hand stays. No match leaves it blank (cards then assume street parking).
//   npm run venue-parking              # all active venues without a note
//   npm run venue-parking -- --dry-run

import "./env";

import { supabase } from "../lib/supabase";

const dryRun = process.argv.includes("--dry-run");
const RADIUS_M = 120;
const OVERPASS = "https://overpass-api.de/api/interpreter";

interface El { tags?: Record<string, string>; center?: { lat: number; lon: number }; lat?: number; lon?: number }

async function nearbyParking(lat: number, lng: number): Promise<El[]> {
  const q = `[out:json][timeout:25];nwr(around:${RADIUS_M},${lat},${lng})[amenity=parking][access!~"^(private|no)$"];out tags center 10;`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "light-pole-venue-parking/1.0" },
      body: `data=${encodeURIComponent(q)}`,
    });
    if (res.ok) return ((await res.json()) as { elements: El[] }).elements;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }
    throw new Error(`Overpass ${res.status}`);
  }
}

/** "Garage nearby (paid)", "Lot for customers", … from the closest-sounding match. */
function describe(els: El[]): string {
  const kinds = els.map((e) => e.tags ?? {});
  const garage = kinds.find((t) => /multi-storey|underground/.test(t.parking ?? ""));
  const pick = garage ?? kinds[0];
  const what = garage ? "Garage" : "Lot";
  const who = pick.access === "customers" ? " for customers" : "";
  const fee = pick.fee === "yes" ? " (paid)" : pick.fee === "no" ? " (free)" : "";
  return `${what}${who} within a block${fee}`;
}

async function main() {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, lat, lng")
    .eq("active", true)
    .is("parking", null)
    .not("lat", "is", null);
  if (error) throw error;
  console.log(`${venues!.length} venues without a parking note.`);
  let found = 0;
  for (const v of venues!) {
    try {
      const els = await nearbyParking(v.lat, v.lng);
      if (els.length) {
        const note = describe(els);
        found++;
        console.log(`  ${v.name}: ${note}`);
        if (!dryRun) await supabase.from("venues").update({ parking: note }).eq("id", v.id);
      }
    } catch (e) {
      console.warn(`  ! ${v.name}: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 1100)); // be gentle with the free Overpass server
  }
  console.log(`${found} of ${venues!.length} have a lot or garage within a block${dryRun ? " (dry run, nothing saved)" : ""}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
