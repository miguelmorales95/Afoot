// Places the search box suggests as you type: LA County cities and the big, well-known
// neighborhoods (no micro-neighborhoods like Palms or Century City). Coordinates are rough
// centers, fine for a 25 km search. Local, so suggestions are instant and never hit a geocoder.
// ZIP codes (and anything not listed) still go through /api/geocode.

export interface Place { name: string; lat: number; lng: number; kind: "city" | "neighborhood"; aka?: string[] }

const city = (name: string, lat: number, lng: number, aka?: string[]): Place => ({ name, lat, lng, kind: "city", aka });
const hood = (name: string, lat: number, lng: number, aka?: string[]): Place => ({ name, lat, lng, kind: "neighborhood", aka });

export const PLACES: Place[] = [
  // Los Angeles neighborhoods (big, recognizable ones only). Launch-area names match lib/areas.ts.
  hood("Downtown LA", 34.043, -118.25, ["DTLA", "Downtown Los Angeles", "Arts District"]),
  hood("Silver Lake", 34.0869, -118.2702, ["Silverlake"]),
  hood("Echo Park", 34.0782, -118.2606),
  hood("Los Feliz", 34.1063, -118.2848),
  hood("Highland Park", 34.1156, -118.1926),
  hood("Eagle Rock", 34.1392, -118.2134),
  hood("Koreatown", 34.0616, -118.3, ["K-Town"]),
  hood("Hollywood", 34.0928, -118.3287),
  hood("Mid-City", 34.0488, -118.3517, ["Mid City"]),
  hood("Boyle Heights", 34.0339, -118.2041),
  hood("Chinatown", 34.0623, -118.2383),
  hood("Little Tokyo", 34.0505, -118.2401),
  hood("South LA", 33.989, -118.278, ["South Los Angeles", "South Central"]),
  hood("Leimert Park", 34.005, -118.331),
  hood("Crenshaw", 34.0101, -118.3355),
  hood("Venice", 33.985, -118.4695),
  hood("Westwood", 34.0635, -118.4455),
  hood("Mar Vista", 34.0028, -118.4304),
  hood("San Pedro", 33.7361, -118.2923),
  hood("Wilmington", 33.7802, -118.2627),
  hood("North Hollywood", 34.1722, -118.379, ["NoHo"]),
  hood("Studio City", 34.1396, -118.3871),
  hood("Sherman Oaks", 34.1508, -118.449),
  hood("Van Nuys", 34.1899, -118.4514),
  hood("Encino", 34.1517, -118.5214),
  hood("Woodland Hills", 34.1683, -118.6059),
  hood("Northridge", 34.2283, -118.5368),
  hood("Atwater Village", 34.1172, -118.2566),
  hood("Lincoln Heights", 34.0738, -118.2077),
  hood("El Sereno", 34.0811, -118.1793),
  hood("Westchester", 33.9591, -118.4004),
  hood("Fairfax", 34.0762, -118.3612),
  // Unincorporated communities people search by name.
  hood("East LA", 34.0239, -118.172, ["East Los Angeles"]),
  hood("Altadena", 34.1897, -118.1312),
  hood("Marina del Rey", 33.9803, -118.4517),

  // Cities (LA County, plus a few just over the line people treat as LA).
  city("Los Angeles", 34.0522, -118.2437, ["LA"]),
  city("Santa Monica", 34.0195, -118.4912),
  city("Culver City", 34.0211, -118.3965),
  city("West Hollywood", 34.09, -118.3617, ["WeHo"]),
  city("Beverly Hills", 34.0736, -118.4004),
  city("Pasadena", 34.1478, -118.1445),
  city("South Pasadena", 34.1161, -118.1503),
  city("Glendale", 34.1425, -118.2551),
  city("Burbank", 34.1808, -118.309),
  city("Long Beach", 33.7701, -118.1937),
  city("Torrance", 33.8358, -118.3406),
  city("Manhattan Beach", 33.8847, -118.4109),
  city("Hermosa Beach", 33.8622, -118.3995),
  city("Redondo Beach", 33.8492, -118.3884),
  city("El Segundo", 33.9192, -118.4165),
  city("Inglewood", 33.9617, -118.3531),
  city("Hawthorne", 33.9164, -118.3526),
  city("Gardena", 33.8883, -118.309),
  city("Carson", 33.8317, -118.282),
  city("Compton", 33.8958, -118.2201),
  city("Lynwood", 33.9303, -118.2115),
  city("South Gate", 33.9547, -118.212),
  city("Huntington Park", 33.9817, -118.2251),
  city("Bell Gardens", 33.9653, -118.1515),
  city("Downey", 33.94, -118.1332),
  city("Norwalk", 33.9022, -118.0817),
  city("Whittier", 33.9792, -118.0328),
  city("Montebello", 34.0165, -118.1138),
  city("Monterey Park", 34.0625, -118.1228),
  city("Alhambra", 34.0953, -118.127),
  city("San Gabriel", 34.0961, -118.1058),
  city("Rosemead", 34.0806, -118.0728),
  city("El Monte", 34.0686, -118.0276),
  city("Arcadia", 34.1397, -118.0353),
  city("Monrovia", 34.1442, -117.9990),
  city("Azusa", 34.1336, -117.9076),
  city("West Covina", 34.0686, -117.939),
  city("Covina", 34.09, -117.8903),
  city("Pomona", 34.0551, -117.75),
  city("Claremont", 34.0967, -117.7198),
  city("Diamond Bar", 34.0286, -117.8103),
  city("La Cañada Flintridge", 34.1992, -118.1878, ["La Canada"]),
  city("Lakewood", 33.8536, -118.1339),
  city("Bellflower", 33.8817, -118.117),
  city("Cerritos", 33.8583, -118.0648),
  city("Signal Hill", 33.8044, -118.1678),
  city("Palos Verdes Estates", 33.8006, -118.3901, ["PV", "Palos Verdes"]),
  city("Rancho Palos Verdes", 33.7445, -118.387),
  city("Malibu", 34.0259, -118.7798),
  city("Calabasas", 34.1367, -118.6615),
  city("Agoura Hills", 34.1533, -118.7617),
  city("San Fernando", 34.2819, -118.4390),
  city("Santa Clarita", 34.3917, -118.5426, ["Valencia"]),
  city("Lancaster", 34.6868, -118.1542),
  city("Palmdale", 34.5794, -118.1165),
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Up to `limit` places matching what's typed: name starts with it first, then a word in the
 *  name (or a nickname) starts with it. Bigger, more-searched places win ties by list order. */
export function suggestPlaces(q: string, limit = 6): Place[] {
  const n = norm(q);
  if (!n) return [];
  const scored: { p: Place; s: number; i: number }[] = [];
  PLACES.forEach((p, i) => {
    const names = [p.name, ...(p.aka ?? [])].map(norm);
    let s = 0;
    for (const name of names) {
      if (name === n) s = Math.max(s, 3);
      else if (name.startsWith(n)) s = Math.max(s, 2);
      else if (name.split(" ").some((w) => w.startsWith(n))) s = Math.max(s, 1);
    }
    if (s) scored.push({ p, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, limit).map((x) => x.p);
}

/** "90026" or "90026-1234" → "90026". */
export const zipOf = (q: string) => q.trim().match(/^(\d{5})(?:-\d{4})?$/)?.[1] ?? null;
