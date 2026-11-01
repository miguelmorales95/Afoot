# Where Afoot looks for events

The goal is to be everywhere: if something public is happening in LA County, Afoot should have
it. This is the checklist of **every kind of place** that publishes events, how Afoot reads each
one, and how far along it is. Update it whenever a source type is added or swept.

**How Afoot reads a source** (cheapest and most reliable first):

| Method | What it is | Code |
|---|---|---|
| **Calendar feed** | An official iCal, Localist, CivicPlus (city calendar RSS) or Communico (library) feed. No AI, exact times, no page-layout breakage. Always prefer this. | `lib/calendarFeeds.ts`, `event_feeds` (kind `ics` / `localist` / `civicplus` / `communico`) |
| **Ticketing API** | Ticketmaster venues and Eventbrite organizers, through their official APIs | `lib/eventApis.ts`, `event_feeds` |
| **Newsletter** | The venue's mailing list, sent to Afoot's inbox and read by AI | `lib/newsletter.ts`, /admin → Newsletters |
| **Calendar page** | The venue's events page, read by AI each night (headless browser when needed) | `lib/ingest.ts`, `venues.events_url` |
| **Event link** | Someone pastes a link on /submit; reviewed in /admin | `lib/eventLink.ts` |
| **Screenshots** | For places that only post on Instagram or Facebook: a local vision model reads screenshots | `SC_2_Afoot/` |

Never scrape Facebook or Instagram, or aggregators whose terms forbid it (Songkick, Yelp, Patch).

**Lists in this folder** (columns: `name, type, city, website, calendar_url, platform, feed_url,
feed_verified, public_events, notes`). Load them with `npm run sources:import -- --dry-run`, then
`npm run sources:import`: rows with a verified feed become feeds, rows with only a page go to the
/admin review queue.

- `colleges.csv`: every college and university in LA County, plus the big ones next door
- `public-places.csv`: parks and recreation, libraries, museums and gardens, malls and plazas, city arts and civic calendars

## Coverage checklist

Status: **swept** = searched and loaded; **partial** = some loaded, more to find; **list ready** =
researched, not imported yet; **to do** = not searched yet.

### Institutions with official calendars (calendar feeds first)

| Place type | Examples | Best method | Status |
|---|---|---|---|
| Universities (UC, CSU, private) | UCLA, USC, CSULB, Caltech, LMU, Pepperdine, Claremont Colleges | Localist / Trumba / iCal | partial: 27 feeds live (2026-11-01) |
| Community colleges (all of LA County) | All 9 LACCD colleges, PCC, SMC, El Camino, LBCC, Mt. SAC | iCal / calendar page | partial: SMC, El Camino, Compton, Glendale, Rio Hondo, Citrus, Cerritos live; LACCD has no feed |
| Art and design schools | ArtCenter, CalArts, Otis, SCI-Arc | iCal / calendar page | list in `colleges.csv` |
| Campus performance centers and museums | CAP UCLA, The Broad Stage, Carpenter Center, Fowler | iCal / Ticketmaster | list in `colleges.csv` |
| College athletics | UCLA/USC home games, CSU and community-college sports | Sidearm iCal feeds | to do |
| Public libraries | LAPL (73 branches), LA County Library (85), city libraries | LibCal / BiblioCommons / Communico iCal | partial: Long Beach live (~200 events); LAPL and County have no feed |
| City parks and recreation | LA City Rec & Parks, LA County Parks, every city's parks department | CivicPlus iCal / calendar page | list in `public-places.csv` |
| Beaches, harbors, state parks | Marina del Rey, Santa Monica Pier, Will Rogers | calendar page | list in `public-places.csv` |
| Museums, gardens, zoo, aquarium | Getty, LACMA, Huntington, Descanso, Aquarium of the Pacific | iCal / Tribe / calendar page | list in `public-places.csv` |
| Big performing-arts venues | Music Center, Hollywood Bowl, Disney Hall, Pantages | Ticketmaster / calendar page | partial (Ticketmaster feeds) |
| Malls and outdoor centers | The Grove, Americana, Westfields, Third Street Promenade, CityWalk | calendar page | list in `public-places.csv` |
| City arts and civic | LA Cultural Affairs, Grand Park, Olvera Street, CicLAvia, city arts councils | iCal / calendar page | list in `public-places.csv` |
| Business improvement districts | Downtown LA, Hollywood, Old Town Torrance, Downtown Long Beach | calendar page | list in `public-places.csv` |
| Neighborhood councils | 99 LA neighborhood councils (town halls, cleanups, fairs) | Google Calendar iCal | to do |
| Community centers and YMCAs | City community centers, YMCAs, senior centers | calendar page | to do |
| Faith communities with public programs | Church concert series, temple festivals, cultural nights | calendar page / newsletter | to do |

### Small and independent venues (Afoot's core)

| Place type | Examples | Best method | Status |
|---|---|---|---|
| Music rooms and clubs | Hotel Cafe, The Mint, Lodge Room, Zebulon | calendar page / Ticketmaster / newsletter | partial (seed list + discovery) |
| Jazz rooms | Sam First, Catalina, Baked Potato, World Stage | calendar page / newsletter | partial |
| Comedy clubs and open mics | Flappers, Lyric Hyperion, Hollywood Improv | calendar page / newsletter | partial |
| Bars with weekly nights | Karaoke, trivia, game nights, DJ nights | calendar page / newsletter / screenshots | partial (discovery crawler) |
| Breweries and wineries | Smog City, Highland Park Brewery, Arts District Brewing | calendar page / newsletter | partial |
| Bookstores | Skylight, Last Bookstore, Octavia's Bookshelf, Small World | calendar page / newsletter | partial |
| Record stores, comic and game shops | Permanent Records, Game Empire, comic shops | calendar page / screenshots | partial (discovery) |
| Cafes with open mics or readings | Stories, Village Well | newsletter / screenshots | partial |
| Galleries and art openings | Avenue 50 Studio, Chinatown galleries, art walks | calendar page / newsletter | partial |
| Small theaters and theater companies | Echo Theater, Skylight Theatre, Pasadena Playhouse | calendar page / Ticketmaster | to do |
| Repertory and indie cinemas | New Beverly, Vidiots, Egyptian, Laemmle | calendar page / iCal | to do |
| Dance socials and studios | Salsa and swing nights, dance studios | calendar page / screenshots | to do |
| Run, ride and hike clubs | Run clubs, group rides, guided hikes | Strava/Meetup links / screenshots | to do |
| Maker spaces, plant and craft shops | Workshops, repair cafes | calendar page / Eventbrite | to do |
| Climbing gyms, bowling, arcades | Community nights, leagues | calendar page | to do |

### Recurring public happenings

| Place type | Examples | Best method | Status |
|---|---|---|---|
| Farmers markets | 100+ certified markets in LA County | market network calendars | to do |
| Night markets and street fairs | 626 Night Market, KTown night market, First Fridays | calendar page / Eventbrite | to do |
| Art walks | Downtown LA Art Walk, Long Beach, Pasadena | calendar page | to do |
| Festivals and parades | Cultural festivals, heritage months, holiday events | city calendars / event links | partial (event links) |
| Organizer pages on Eventbrite | Local organizers that list everything on Eventbrite | Eventbrite organizer feed | partial (feed support, 0 feeds yet) |

### Where the discovery crawler searches

`lib/discovery-queries.ts` combines ~70 LA areas with activity terms (karaoke, trivia, open mic,
live music, comedy, run club…) and place types (breweries, bookstores, record stores, libraries,
parks, community centers, farmers markets, night markets, museums, galleries, theaters, colleges,
dance studios, climbing gyms, maker spaces, cultural centers, shopping centers, neighborhood
councils). Each `npm run discover` run takes a random slice, so repeated runs widen coverage.

## Sweep notes

**`colleges.csv`, 2026-11-01** (65 schools). 27 have a working feed (5 Localist, 7 WordPress `?ical=1`,
5 25Live, 5 Modern Campus, 4 Trumba, Occidental's own); all 27 imported and pulled: ~1,900 events in the
next 60 days. 35 calendar pages went to the /admin review queue. **No feed found:** UCLA, UC Irvine,
Caltech, CSULB, Cal State LA, CSUDH, CSUF, CSUSB, all 9 LACCD colleges, PCC, LBCC, Mt. SAC, College of the
Canyons, Antelope Valley, Pitzer, Biola, Whittier, Drew, CalArts, ArtCenter, SCI-Arc, and campus venues
(CAP UCLA, Hammer, REDCAT, Carpenter Center, BroadStage). Several campus sites refuse non-browser requests.
After importing, venues the geocoder couldn't place were given their street address (17 on 2026-11-01).

**`public-places.csv`, 2026-11-01** (99 places: 38 parks and recreation, 12 libraries, 27 museums and
gardens, 9 malls, 13 civic). 21 have a working feed; 7 of them are iCal and become feeds on import (Long Beach
libraries alone list ~200 events in 60 days). The rest go to the review queue as calendar pages.

- **CivicPlus and Communico, 2026-11-01:** the 10 cities' CivicPlus calendars and Glendale's libraries
  (Communico) are now read as feeds (~400 dates; council and commission meetings filtered out). Their
  venues' `events_url` was cleared so the AI doesn't read the same calendar twice. Inglewood's feed is empty
  for now. Other Communico libraries (`*.libnet.info`) can be added from /admin → feeds.
- **Read by the AI as calendar pages instead:** Beaches & Harbors (EventON keeps dates out of its JSON),
  Arboretum and Hammer (their RSS has dates only in the text).
- **All 82 calendar pages from both lists were approved on 2026-11-01** and given street addresses.
- **Sites that block scripted reading** (403/429): LA City Rec & Parks, Burbank, Santa Clarita, Huntington,
  Descanso, LA Zoo, California Science Center, Music Center, Craft Contemporary, Forest Lawn, CityWalk, Carson.
  The nightly headless browser may get through; otherwise newsletters or Ticketmaster.
- **No feed found for the biggest libraries:** LAPL and LA County Library (together ~160 branches). Their
  events pages need the AI reader, or a request to the library for a feed.
- **Not covered yet:** the other city libraries (Torrance, Beverly Hills, Palos Verdes, Redondo, Inglewood,
  Alhambra, Whittier, Pomona), LA Cultural Affairs, Long Beach and Santa Monica arts councils, MOLAA,
  farmers market networks, and the cities with no calendar found (Glendale, Manhattan Beach, Redondo,
  El Segundo, Lancaster, Pomona, Downey, Compton, South Gate, Pico Rivera, Norwalk, Cerritos).
