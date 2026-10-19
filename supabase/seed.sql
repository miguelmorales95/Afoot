-- Seed venues. Run after schema.sql.
-- lat/lng are filled in for the two we're confident about so the app works
-- immediately. Any venue with a NULL lat/lng gets geocoded from `address`
-- by `npm run geocode`. New Wave's exact address is left for you to confirm.

insert into venues (name, slug, website, events_url, address, city, lat, lng, description, source)
values
  (
    'Smog City Brewing - Torrance',
    'smog-city-torrance',
    'https://www.smogcitybrewing.com/torrance',
    'https://www.smogcitybrewing.com/fts',
    '1901 Del Amo Blvd, Torrance, CA 90501',
    'Torrance',
    33.83912, -118.32695,
    'Brewery taproom with live outdoor music, tabletop game nights, and themed parties.',
    'seed'
  ),
  (
    'Zebulon',
    'zebulon-la',
    'https://zebulon.la/',
    'https://zebulon.la/',
    '2478 Fletcher Dr, Los Angeles, CA 90039',
    'Los Angeles',
    34.11028, -118.25853,
    'Frogtown cafe + concert venue with an eclectic nightly music calendar.',
    'seed'
  ),
  (
    'New Wave',
    'new-wave',
    'https://www.newwaverestaurant.com/',
    'https://www.newwaverestaurant.com/events',
    null,                      -- TODO: confirm street address, then run `npm run geocode`
    'Los Angeles',
    null, null,
    'Late-night restaurant & bar with a rotating events calendar.',
    'seed'
  )
on conflict (slug) do update
  set website     = excluded.website,
      events_url  = excluded.events_url,
      description = excluded.description;
