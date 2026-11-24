-- ===========================================================================
-- Weekly email ("your week on the pole"): one row per address, holding the filters the person
-- had on when they signed up (place + event types). Double opt-in: nothing is sent until the
-- link in the confirmation email is clicked. Server only (no anon access). Same statements as
-- the "Weekly email" block at the end of supabase/schema.sql; safe to re-run.
-- ===========================================================================
create table if not exists afoot.email_subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,          -- lowercased
  place_label       text not null,                 -- "Echo Park", "90026", "All of LA"
  lat               double precision not null,
  lng               double precision not null,
  radius_km         int not null default 25,
  types             text[] not null default '{}',  -- empty = everything (music, comedy, class, art, games, market, food)
  token             text not null unique,          -- confirm / unsubscribe / change links
  confirmed_at      timestamptz,
  unsubscribed_at   timestamptz,
  last_sent_at      timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_email_subscribers_active on afoot.email_subscribers(confirmed_at) where unsubscribed_at is null;
alter table afoot.email_subscribers enable row level security;
revoke all on afoot.email_subscribers from anon, authenticated;
grant all on afoot.email_subscribers to service_role;
