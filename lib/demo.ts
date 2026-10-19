// Built-in sample data so `npm run dev` shows a fully designed, populated UI
// with no Supabase/keys. Auto-enabled when Supabase isn't configured, or force
// it with DEMO_MODE=1. Dates are generated relative to "now" so the feed is
// always full of upcoming events.
//
// Venues/schedules below are real LA spots used as representative sample data;
// times change, so this is for design/demo only, not a live listing.

import { hasSupabase } from "./supabase";
import type { NearbyEvent, ReviewGroup } from "./types";

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || !hasSupabase;
}

interface DemoSpec {
  venue: string;
  lat: number;
  lng: number;
  address: string;
  title: string;
  description: string;
  category: NearbyEvent["category"];
  price: string | null;
  tags: string[];
  recurrence: string | null;
  dows: number[]; // 0=Sun..6=Sat (can be multiple nights/week)
  hour: number;
  minute: number;
  url: string | null;
}

const SPECS: DemoSpec[] = [
  // --- seed venues ---
  {
    venue: "Smog City Brewing — Torrance", lat: 33.83912, lng: -118.32695,
    address: "1901 Del Amo Blvd, Torrance",
    title: "Live Outdoor Music", description: "Local bands on the back patio with the taps flowing.",
    category: "music", price: "Free", tags: ["outdoor", "chill", "live band", "all-ages"],
    recurrence: "Every Sunday evening", dows: [0], hour: 18, minute: 0,
    url: "https://www.smogcitybrewing.com/torrance",
  },
  {
    venue: "Smog City Brewing — Torrance", lat: 33.83912, lng: -118.32695,
    address: "1901 Del Amo Blvd, Torrance",
    title: "Tabletop Game Night", description: "Bring your crew or borrow from the shelf — board games and beer.",
    category: "games", price: "Free", tags: ["chill", "beginner-friendly", "indoor", "all-ages"],
    recurrence: "2nd & 4th Tuesday", dows: [2], hour: 18, minute: 0,
    url: "https://www.smogcitybrewing.com/torrance",
  },
  {
    venue: "Zebulon", lat: 34.11028, lng: -118.25853, address: "2478 Fletcher Dr, Los Angeles",
    title: "Zebulon Live: Jazz & Beyond", description: "Eclectic nightly lineup in the Frogtown listening room.",
    category: "music", price: "$15-20", tags: ["live band", "standing", "21+", "lively"],
    recurrence: "Friday & Saturday nights", dows: [5, 6], hour: 21, minute: 0,
    url: "https://zebulon.la/",
  },
  // --- karaoke ---
  {
    venue: "Brass Monkey", lat: 34.0616, lng: -118.2987, address: "3440 Wilshire Blvd, Koreatown",
    title: "Karaoke at Brass Monkey", description: "Rowdy, packed, sing-till-2am K-town institution behind a strip mall.",
    category: "karaoke", price: "Free", tags: ["lively", "loud", "21+", "late night"],
    recurrence: "Nightly", dows: [3, 4, 5, 6], hour: 21, minute: 0,
    url: "https://brassmonkeyla.com/",
  },
  {
    venue: "Backstage Bar & Grill", lat: 34.0280, lng: -118.3730, address: "3400 Overland Ave, Culver City",
    title: "Karaoke Nights", description: "Dive-y Culver City staple with a huge songbook and stiff pours.",
    category: "karaoke", price: "Free", tags: ["chill", "21+", "dive", "solo-friendly"],
    recurrence: "Thursday–Saturday", dows: [4, 5, 6], hour: 20, minute: 0, url: null,
  },
  {
    venue: "The Irish Times", lat: 34.0307, lng: -118.4017, address: "3267 Motor Ave, Palms",
    title: "Karaoke Wednesdays & Fridays", description: "Neighborhood Irish pub, karaoke twice a week at 9.",
    category: "karaoke", price: "Free", tags: ["chill", "21+", "dive"],
    recurrence: "Wednesday & Friday", dows: [3, 5], hour: 21, minute: 0, url: null,
  },
  {
    venue: "Highland Park Bowl", lat: 34.1120, lng: -118.1925, address: "5621 N Figueroa St, Los Angeles",
    title: "Karaoke in the Alley", description: "Belt it out between bowling lanes under the neon.",
    category: "karaoke", price: "Free", tags: ["lively", "21+", "indoor", "date-night"],
    recurrence: "Every Wednesday", dows: [3], hour: 21, minute: 0,
    url: "https://www.highlandparkbowl.com/",
  },
  // --- trivia ---
  {
    venue: "The Verdugo Bar", lat: 34.1225, lng: -118.2099, address: "3408 Verdugo Rd, Glassell Park",
    title: "Trivia Tuesdays", description: "Pub quiz on the big outdoor patio; winning table drinks on the house.",
    category: "trivia", price: "Free", tags: ["competitive", "chill", "21+", "outdoor"],
    recurrence: "Every Tuesday", dows: [2], hour: 19, minute: 30, url: null,
  },
  {
    venue: "Bigfoot Lodge", lat: 34.1175, lng: -118.2720, address: "3172 Los Feliz Blvd, Los Angeles",
    title: "Wednesday Trivia", description: "Cabin-themed Los Feliz dive, Smokey the Bear watching over the quiz.",
    category: "trivia", price: "Free", tags: ["competitive", "21+", "cozy", "dive"],
    recurrence: "Every Wednesday", dows: [3], hour: 21, minute: 0, url: null,
  },
  {
    venue: "The Surly Goat", lat: 34.0902, lng: -118.3660, address: "7929 Santa Monica Blvd, West Hollywood",
    title: "Pop Culture Trivia", description: "Craft-beer bar, Monday trivia heavy on movies and music.",
    category: "trivia", price: "Free", tags: ["competitive", "21+", "beer"],
    recurrence: "Every Monday", dows: [1], hour: 20, minute: 30, url: null,
  },
  // --- games ---
  {
    venue: "Mandrake", lat: 34.0271, lng: -118.3891, address: "2692 S La Cienega Blvd, Los Angeles",
    title: "Board Game Happy Hour", description: "Artsy Culver City dive with a wall of games and cheap drafts.",
    category: "games", price: "Free", tags: ["chill", "indoor", "beginner-friendly", "21+"],
    recurrence: "Every Sunday", dows: [0], hour: 16, minute: 0, url: null,
  },
  // --- live music / open mic ---
  {
    venue: "Solarc Brewing", lat: 34.1290, lng: -118.2130, address: "3505 Eagle Rock Blvd, Glassell Park",
    title: "Live Improvised Music", description: "Jazz, synth jams and experimental sets most nights at this tea-and-beer spot.",
    category: "music", price: "Free", tags: ["chill", "live band", "experimental", "all-ages"],
    recurrence: "Most nights", dows: [3, 4, 5], hour: 19, minute: 30, url: null,
  },
  {
    venue: "Little Beast", lat: 34.1385, lng: -118.2110, address: "1496 Colorado Blvd, Eagle Rock",
    title: "Patio Live Music", description: "Local musicians on the garden patio of this Eagle Rock favorite.",
    category: "music", price: "Free", tags: ["outdoor", "chill", "live band", "date-night"],
    recurrence: "Every Thursday", dows: [4], hour: 19, minute: 0, url: null,
  },
  {
    venue: "Spoke Bicycle Café", lat: 34.1115, lng: -118.2490, address: "3050 N Coolidge Ave, Frogtown",
    title: "Riverside Open Mic", description: "Acoustic sets and open mic by the LA River; bikes and beers.",
    category: "comedy", price: "Free", tags: ["outdoor", "cozy", "acoustic", "all-ages", "open mic"],
    recurrence: "Every Thursday", dows: [4], hour: 18, minute: 30, url: null,
  },
  {
    venue: "Stories Books & Cafe", lat: 34.0782, lng: -118.2606, address: "1716 W Sunset Blvd, Echo Park",
    title: "Open Mic Night", description: "Poetry, songs, and standup on the back patio. Sign-ups at 7.",
    category: "comedy", price: "Free", tags: ["cozy", "all-ages", "acoustic", "solo-friendly"],
    recurrence: "Every Thursday", dows: [4], hour: 19, minute: 30, url: "https://storiesla.com/",
  },
  {
    venue: "Gold Line", lat: 34.1168, lng: -118.1932, address: "5607 N Figueroa St, Highland Park",
    title: "Vinyl Night", description: "Guest selectors spin all-vinyl sets; natural wine specials.",
    category: "music", price: "Free", tags: ["chill", "dj", "cozy", "21+"],
    recurrence: "Every Monday", dows: [1], hour: 20, minute: 0, url: null,
  },
  // --- markets / all-ages ---
  {
    venue: "Grand Central Market", lat: 34.0506, lng: -118.2487, address: "317 S Broadway, Los Angeles",
    title: "Friday Night Market Sessions", description: "Free live music among the food stalls downtown.",
    category: "market", price: "Free", tags: ["food available", "all-ages", "lively", "indoor"],
    recurrence: "Every Friday", dows: [5], hour: 18, minute: 0,
    url: "https://www.grandcentralmarket.com/",
  },
  {
    venue: "All Star Lanes", lat: 34.1360, lng: -118.2200, address: "4459 Eagle Rock Blvd, Eagle Rock",
    title: "Karaoke & Bowl", description: "Retro Eagle Rock bowling alley with a lounge and nightly karaoke.",
    category: "karaoke", price: "Free", tags: ["lively", "all-ages", "indoor", "date-night"],
    recurrence: "Every Friday", dows: [5], hour: 21, minute: 0, url: null,
  },
];

/** ISO timestamp for the next `weeksAhead`th occurrence of a weekday/time. */
function nextOccurrence(dow: number, hour: number, minute: number, weeksAhead: number): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  let diff = (dow - d.getDay() + 7) % 7;
  if (diff === 0 && d.getTime() < Date.now()) diff = 7;
  d.setDate(d.getDate() + diff + weeksAhead * 7);
  return d.toISOString();
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Demo version of the nearby_events RPC. */
export function demoNearby(lat: number, lng: number, radiusKm = 40): NearbyEvent[] {
  const rows: NearbyEvent[] = [];
  SPECS.forEach((s, i) => {
    const distance = haversineKm(lat, lng, s.lat, s.lng);
    if (distance > radiusKm) return;
    s.dows.forEach((dow) => {
      [0, 1].forEach((w) => {
        const start = nextOccurrence(dow, s.hour, s.minute, w);
        rows.push({
          occurrence_id: `demo-${i}-${dow}-${w}`,
          event_id: `demo-${i}`,
          title: s.title,
          description: s.description,
          category: s.category,
          price: s.price,
          url: s.url,
          recurrence_description: s.recurrence,
          is_recurring: !!s.recurrence,
          tags: s.tags,
          starts_at: start,
          ends_at: null,
          venue_id: `demo-venue-${i}`,
          venue_name: s.venue,
          venue_address: s.address,
          venue_lat: s.lat,
          venue_lng: s.lng,
          distance_km: distance,
        });
      });
    });
  });
  return rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

// Well-known LA points so the search box works offline in demo mode.
export const DEMO_PLACES: Record<string, { lat: number; lng: number; label: string }> = {
  "los angeles": { lat: 34.0522, lng: -118.2437, label: "Los Angeles, CA" },
  "downtown": { lat: 34.0505, lng: -118.2503, label: "Downtown, Los Angeles" },
  "echo park": { lat: 34.0782, lng: -118.2606, label: "Echo Park, Los Angeles" },
  "silver lake": { lat: 34.0869, lng: -118.2702, label: "Silver Lake, Los Angeles" },
  "highland park": { lat: 34.1156, lng: -118.1926, label: "Highland Park, Los Angeles" },
  "eagle rock": { lat: 34.1397, lng: -118.2114, label: "Eagle Rock, Los Angeles" },
  "glassell park": { lat: 34.1178, lng: -118.2286, label: "Glassell Park, Los Angeles" },
  "los feliz": { lat: 34.1061, lng: -118.2872, label: "Los Feliz, Los Angeles" },
  "frogtown": { lat: 34.1115, lng: -118.2490, label: "Frogtown, Los Angeles" },
  "koreatown": { lat: 34.0616, lng: -118.3000, label: "Koreatown, Los Angeles" },
  "culver city": { lat: 34.0211, lng: -118.3965, label: "Culver City, CA" },
  "west hollywood": { lat: 34.0900, lng: -118.3617, label: "West Hollywood, CA" },
  "palms": { lat: 34.0307, lng: -118.4017, label: "Palms, Los Angeles" },
  "santa monica": { lat: 34.0195, lng: -118.4912, label: "Santa Monica, CA" },
  "torrance": { lat: 33.8358, lng: -118.3406, label: "Torrance, CA" },
};

export function demoGeocode(q: string) {
  const key = q.trim().toLowerCase().replace(/,.*$/, "");
  return DEMO_PLACES[key] ?? DEMO_PLACES["los angeles"];
}

// Sample review-queue data so the /admin page is explorable offline. Includes a
// duplicate of an existing venue (Zebulon) to demonstrate the de-dupe, and two
// submissions for the same site to show grouping.
export function demoReviewGroups(): ReviewGroup[] {
  const now = new Date().toISOString();
  return [
    {
      domain: "thelincolnla.com",
      name: "The Lincoln",
      website: "https://thelincolnla.com",
      events_url: "https://thelincolnla.com/events",
      newsletter_url: null,
      neighborhood: "Highland Park",
      city: "Los Angeles",
      score: 0.86,
      sources: [
        { kind: "discovery", id: "d1", note: "Coffee bar with weekly live music and comedy", score: 0.86, created_at: now },
        { kind: "submission", id: "s1", note: "They do comedy every Tuesday, posts it in their IG stories", score: null, created_at: now },
      ],
    },
    {
      domain: "thevirgil.com",
      name: "The Virgil",
      website: "https://thevirgil.com",
      events_url: "https://thevirgil.com/calendar",
      newsletter_url: "https://thevirgil.com/newsletter",
      neighborhood: "Silver Lake",
      city: "Los Angeles",
      score: 0.79,
      sources: [
        { kind: "discovery", id: "d2", note: "Cocktail bar + back room: comedy, music, bingo", score: 0.79, created_at: now },
      ],
    },
    {
      domain: "kingelesbar.com",
      name: "King Eng Lui (Kings Row?)",
      website: "https://kingelesbar.com",
      events_url: null,
      newsletter_url: null,
      neighborhood: "Eagle Rock",
      city: "Los Angeles",
      score: 0.58,
      sources: [
        { kind: "submission", id: "s2", note: "Pretty sure they have trivia? not 100%", score: null, created_at: now },
      ],
    },
    {
      domain: "lacitacantina.com",
      name: "La Cita Bar",
      website: "https://lacitacantina.com",
      events_url: "https://lacitacantina.com/events",
      newsletter_url: null,
      neighborhood: "Downtown",
      city: "Los Angeles",
      score: 0.9,
      sources: [
        { kind: "discovery", id: "d3", note: "DTLA dive: cumbia nights, punk, DJ nights all week", score: 0.9, created_at: now },
        { kind: "submission", id: "s3", note: "Goth night Thursdays!!", score: null, created_at: now },
        { kind: "submission", id: "s4", note: "cumbia sundays are the best", score: null, created_at: now },
      ],
    },
  ];
}
