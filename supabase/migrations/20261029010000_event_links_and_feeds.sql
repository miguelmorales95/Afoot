-- ===========================================================================
-- Event links and event feeds. Same statements as the "Event links and feeds" block at the end of
-- supabase/schema.sql; safe to re-run. Server-only: RLS on, no anon/authenticated policies.
--
-- event_links: one event someone pasted on /submit (a Facebook, Eventbrite, Ticketmaster or any
--   other event page). The server reads what it can from the page (or the official API) into
--   `extracted`; an admin checks it in /admin and approves it into events.
-- event_feeds: an Eventbrite organizer or a Ticketmaster venue whose upcoming events are pulled
--   through their official APIs every day (npm run feeds, in the GitHub Actions job).
-- ===========================================================================

create schema if not exists afoot;

create table if not exists afoot.event_links (
  id              uuid primary key default gen_random_uuid(),
  url             text not null,
  source          text not null default 'other',  -- facebook | eventbrite | ticketmaster | meetup | other
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  extracted       jsonb,           -- { title, description, starts_at, ends_at, venue_name, address, lat, lng, price, category }
  read_error      text,            -- why the page couldn't be read (the submitter's own details are used then)
  note            text,
  submitter_email text,
  event_id        uuid references afoot.events(id) on delete set null,
  created_at      timestamptz default now()
);
create index if not exists idx_event_links_status on afoot.event_links(status, created_at);
alter table afoot.event_links enable row level security;

create table if not exists afoot.event_feeds (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('eventbrite_organizer', 'ticketmaster_venue')),
  ref         text not null,       -- the organizer or venue id at that service
  label       text,
  active      boolean not null default true,
  last_run_at timestamptz,
  last_result text,
  created_at  timestamptz default now(),
  unique (kind, ref)
);
alter table afoot.event_feeds enable row level security;

grant all on afoot.event_links, afoot.event_feeds to service_role;
