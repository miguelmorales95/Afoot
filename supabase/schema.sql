-- WhatsUp schema. Run this in the Supabase SQL editor (or `supabase db push`).
-- Design: a venue has many events (series); each event has many concrete
-- occurrences (expanded dates). The feed queries occurrences near a point.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists venues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text unique not null,
  website          text,
  events_url       text,                    -- page the ingester scrapes (falls back to website)
  newsletter_url   text,                    -- mailing-list signup, when known
  address          text,
  city             text default 'Los Angeles',
  lat              double precision,
  lng              double precision,
  description      text,
  source           text default 'seed',     -- seed | submission | sourced
  active           boolean default true,
  render           boolean default false,   -- force headless-browser fetch (JS-rendered sites)
  last_ingested_at timestamptz,
  created_at       timestamptz default now()
);

-- For existing databases created before the `render` column existed:
alter table venues add column if not exists render boolean default false;
alter table venues add column if not exists newsletter_url text;

create table if not exists events (
  id                     uuid primary key default gen_random_uuid(),
  venue_id               uuid not null references venues(id) on delete cascade,
  title                  text not null,
  description            text,
  category               text,              -- music | karaoke | trivia | games | comedy | market | food | class | other
  price                  text,              -- free-form, e.g. "Free", "$10", "$15-25"
  url                    text,              -- link to the event/detail page
  recurrence_description text,              -- human readable, e.g. "Every 2nd & 4th Tuesday"
  is_recurring           boolean default false,
  tags                   text[] default '{}',  -- vibe/activity tags, e.g. {outdoor,chill,"live band"}
  source                 text default 'website',  -- website | newsletter | manual
  dedupe_key             text unique,       -- normalized venue_id + title, keeps re-ingests idempotent
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create table if not exists event_occurrences (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  created_at timestamptz default now(),
  unique (event_id, starts_at)
);

create table if not exists submissions (
  id              uuid primary key default gen_random_uuid(),
  venue_name      text,
  website         text not null,
  events_url      text,
  city            text,
  note            text,
  submitter_email text,
  status          text default 'pending',   -- pending | approved | rejected
  created_at      timestamptz default now()
);

-- Candidate venues found by the web discovery crawler (scripts/discover.ts).
-- Reviewed/approved here, then promoted into `venues` (scripts/promote.ts).
create table if not exists candidate_venues (
  id             uuid primary key default gen_random_uuid(),
  domain         text unique not null,     -- dedupe key (hostname w/o www)
  url            text,
  venue_name     text,
  venue_type     text,
  neighborhood   text,
  city           text,
  address        text,
  events_url     text,
  newsletter_url text,
  categories     text[] default '{}',
  score          double precision,         -- classifier confidence 0..1
  reason         text,
  source_query   text,
  status         text default 'new',       -- new | approved | rejected | promoted
  created_at     timestamptz default now()
);

-- Maps a newsletter sender to a venue, so inbound emails route to the right
-- place. Newsletters often come from an ESP domain (mailchimp, substack, etc.)
-- that won't match the venue's website, so we match on several signals.
create table if not exists newsletter_sources (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid references venues(id) on delete cascade,
  from_address  text,          -- exact sender, e.g. news@smogcitybrewing.com
  from_domain   text,          -- sender domain, e.g. smogcitybrewing.com or mcsv.net
  match_keyword text,          -- optional substring to match in from-name/subject/body
  label         text,
  active        boolean default true,
  created_at    timestamptz default now()
);
create unique index if not exists idx_news_src_addr
  on newsletter_sources(lower(from_address)) where from_address is not null;
create index if not exists idx_news_src_domain on newsletter_sources(from_domain);

-- Log + queue of inbound newsletter emails (webhook or IMAP poller).
create table if not exists inbound_emails (
  id               uuid primary key default gen_random_uuid(),
  message_id       text unique,   -- email Message-ID for idempotency
  from_address     text,
  from_name        text,
  to_address       text,
  subject          text,
  received_at      timestamptz,
  body_text        text,
  matched_venue_id uuid references venues(id) on delete set null,
  status           text default 'new',  -- new | processed | unmatched | error
  events_found     int default 0,
  note             text,
  created_at       timestamptz default now()
);
create index if not exists idx_inbound_status on inbound_emails(status, created_at desc);

create index if not exists idx_occ_starts    on event_occurrences(starts_at);
create index if not exists idx_events_venue  on events(venue_id);
create index if not exists idx_venues_latlng on venues(lat, lng);
create index if not exists idx_cand_status   on candidate_venues(status, score desc);

-- ---------------------------------------------------------------------------
-- nearby_events: upcoming occurrences within a radius of a point.
-- Uses the haversine formula directly so no PostGIS/earthdistance extension
-- is required (keeps the free tier dead simple).
-- ---------------------------------------------------------------------------

create or replace function nearby_events(
  in_lat        double precision,
  in_lng        double precision,
  in_radius_km  double precision default 15,
  in_days_ahead int default 30
)
returns table (
  occurrence_id          uuid,
  event_id               uuid,
  title                  text,
  description            text,
  category               text,
  price                  text,
  url                    text,
  recurrence_description text,
  is_recurring           boolean,
  tags                   text[],
  starts_at              timestamptz,
  ends_at                timestamptz,
  venue_id               uuid,
  venue_name             text,
  venue_address          text,
  venue_lat              double precision,
  venue_lng              double precision,
  distance_km            double precision
)
language sql
stable
as $$
  with scored as (
    select
      o.id as occurrence_id,
      e.id as event_id,
      e.title, e.description, e.category, e.price, e.url,
      e.recurrence_description, e.is_recurring, e.tags,
      o.starts_at, o.ends_at,
      v.id as venue_id, v.name as venue_name, v.address as venue_address,
      v.lat as venue_lat, v.lng as venue_lng,
      (6371 * acos(
        least(1, greatest(-1,
          cos(radians(in_lat)) * cos(radians(v.lat)) *
          cos(radians(v.lng) - radians(in_lng)) +
          sin(radians(in_lat)) * sin(radians(v.lat))
        ))
      )) as distance_km
    from event_occurrences o
    join events e on e.id = o.event_id
    join venues v on v.id = e.venue_id
    where v.active
      and v.lat is not null
      and v.lng is not null
      and o.starts_at >= now()
      and o.starts_at <= now() + make_interval(days => in_days_ahead)
  )
  select *
  from scored
  where distance_km <= in_radius_km
  order by starts_at asc, distance_km asc;
$$;

-- ---------------------------------------------------------------------------
-- Row level security.
-- The app reads through server routes using the service role (which bypasses
-- RLS), but we also allow anonymous SELECT so you can safely query from the
-- browser later. Writes stay server-only (no anon insert policies).
-- ---------------------------------------------------------------------------

alter table venues            enable row level security;
alter table events            enable row level security;
alter table event_occurrences enable row level security;
alter table submissions       enable row level security;
alter table candidate_venues  enable row level security;
alter table newsletter_sources enable row level security;
alter table inbound_emails    enable row level security;
-- candidate_venues / newsletter_sources / inbound_emails: no anon policy ->
-- server (service role) only.

drop policy if exists "public read venues"      on venues;
drop policy if exists "public read events"       on events;
drop policy if exists "public read occurrences"  on event_occurrences;

create policy "public read venues"     on venues            for select using (active);
create policy "public read events"      on events            for select using (true);
create policy "public read occurrences" on event_occurrences for select using (true);
-- submissions: no anon policy -> only the service role (server) can read/write them.
