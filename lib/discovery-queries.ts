// Seed queries for the discovery crawler: LA neighborhoods x event activities.
// Generates a large, varied query set so the crawler keeps finding new venues
// the longer you leave it running.

export const LA_AREAS = [
  "Los Angeles",
  "Downtown LA",
  "Echo Park",
  "Silver Lake",
  "Highland Park",
  "Eagle Rock",
  "Los Feliz",
  "Atwater Village",
  "Frogtown",
  "Chinatown",
  "Koreatown",
  "West Adams",
  "Culver City",
  "Mar Vista",
  "Venice",
  "Santa Monica",
  "Mid City",
  "Hollywood",
  "East Hollywood",
  "Glendale",
  "Pasadena",
  "Burbank",
  "Long Beach",
  "San Pedro",
  "Torrance",
  "Redondo Beach",
  "Inglewood",
  "North Hollywood",
  "Studio City",
  "Van Nuys",
  "Boyle Heights",
  "Lincoln Heights",
  // The rest of the county: every launch area's neighbors, plus the big cities.
  "East LA",
  "South LA",
  "Leimert Park",
  "Crenshaw",
  "Westwood",
  "Palms",
  "Sawtelle",
  "West Hollywood",
  "Beverly Hills",
  "Manhattan Beach",
  "Hermosa Beach",
  "El Segundo",
  "Gardena",
  "Carson",
  "San Pedro",
  "Compton",
  "Downey",
  "Whittier",
  "Montebello",
  "Alhambra",
  "Monterey Park",
  "San Gabriel",
  "Arcadia",
  "Monrovia",
  "Pomona",
  "Claremont",
  "West Covina",
  "Sherman Oaks",
  "Encino",
  "Northridge",
  "Reseda",
  "Sun Valley",
  "Sylmar",
  "Santa Clarita",
  "Lancaster",
  "Palmdale",
  "Malibu",
];

export const ACTIVITIES = [
  "karaoke night",
  "trivia night",
  "board game night",
  "bar games night",
  "open mic night",
  "live music",
  "comedy open mic",
  "stand up comedy",
  "DJ night",
  "bingo night",
  "vinyl night",
  "poetry reading",
  "craft night",
  "paint and sip",
  "run club",
  "chess club",
  "game night brewery",
  "weekly live music",
];

// Venue types worth sweeping even without a specific activity term.
export const VENUE_TYPES = [
  "brewery events",
  "dive bar events",
  "cafe events calendar",
  "bookstore events",
  "record store events",
  "wine bar events",
  "cocktail bar weekly events",
  "music venue calendar",
  "coffee shop open mic",
  // Places with public calendars beyond bars and venues (see data/sources/README.md).
  "community center events",
  "public library events",
  "park events calendar",
  "recreation center classes",
  "farmers market",
  "night market",
  "museum events",
  "art gallery opening",
  "theater company shows",
  "college events calendar",
  "dance studio social",
  "climbing gym events",
  "maker space workshop",
  "plant shop workshop",
  "comic shop events",
  "church concert series",
  "cultural center events",
  "shopping center events",
  "neighborhood council events",
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a shuffled list of search queries. Shuffling means each run explores a
 * different slice, so repeated runs broaden coverage instead of repeating.
 */
export function buildQueries(limit = 60): string[] {
  const queries: string[] = [];
  for (const area of LA_AREAS) {
    for (const act of ACTIVITIES) queries.push(`${act} ${area}`);
    for (const vt of VENUE_TYPES) queries.push(`${vt} ${area}`);
  }
  return shuffle(queries).slice(0, limit);
}
