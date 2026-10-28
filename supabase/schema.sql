-- Afoot schema. Run this in the Supabase SQL editor (or `supabase db push`).
-- Everything lives in its own `afoot` schema so it never collides with other apps
-- sharing this Supabase project (NoBucks' Prisma tables live in `public`).
-- After the first run, add `afoot` to Project Settings -> Data API -> Exposed schemas.
-- Design: a venue has many events (series); each event has many concrete
-- occurrences (expanded dates). The feed queries occurrences near a point.

create schema if not exists afoot;
set search_path = afoot, public, extensions;

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

-- How sure we are about each event, and where that came from. Uncertain fields are
-- shown to users ("Time unconfirmed") and asked about as one-tap checks.
alter table events add column if not exists confidence text default 'high'
  check (confidence in ('high', 'medium', 'low'));
alter table events add column if not exists uncertain_fields text[] default '{}'; -- starts_at | date | address | price
alter table events add column if not exists source_url text;
alter table events add column if not exists notes text;             -- what's uncertain and why
alter table events add column if not exists status text default 'active'
  check (status in ('active', 'hidden'));                          -- hidden: removed after reports
alter table events add column if not exists verified_at timestamptz;
alter table events add column if not exists verified_by text;      -- venue | source | community | ai | admin
alter table event_occurrences add column if not exists cancelled boolean default false;
-- AI clean-up job (npm run recheck): when an event's source page was last re-read, and the outcome.
alter table events add column if not exists rechecked_at timestamptz;
alter table events add column if not exists recheck_note text;

-- People's feedback on events, keyed by a hashed random device id (no login, no IP).
--   kind 'report':   wrong_info | cancelled | scam | not_real | duplicate | inappropriate
--   kind 'heads_up': parking | crowded | not_as_described | not_accessible | unsafe | great_vibe
create table if not exists event_flags (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  occurrence_id uuid references event_occurrences(id) on delete set null,
  kind          text not null check (kind in ('report', 'heads_up')),
  reason        text not null,
  note          text check (char_length(note) <= 500),
  device_hash   text not null,
  user_id       uuid references auth.users(id) on delete set null,
  status        text default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at    timestamptz default now()
);
-- One flag per device per reason per event (or per date, for date-specific reports).
create unique index if not exists idx_flags_once
  on event_flags(event_id, coalesce(occurrence_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, reason, device_hash);
create index if not exists idx_flags_open on event_flags(status, created_at desc);

-- One-tap answers to "Is this at 8pm?" style questions about uncertain fields.
create table if not exists event_checks (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events(id) on delete cascade,
  occurrence_id uuid references event_occurrences(id) on delete set null,
  field         text not null,                      -- starts_at | date | address | price
  answer        text not null check (answer in ('yes', 'no', 'unsure')),
  device_hash   text not null,
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz default now(),
  unique (event_id, field, device_hash)
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

-- ===========================================================================
-- Accounts, RSVPs, and privacy-first contact exchange
-- ===========================================================================

-- Public-facing profile. `phone` is PRIVATE: it is never returned by a public
-- query and is revealed only through an approved contact request.
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  phone        text,                  -- private
  share_phone  boolean default true,  -- may this be shared on approval?
  created_at   timestamptz default now()
);

-- Auto-create a profile when someone signs up (name/avatar from the OAuth provider).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = afoot
as $$
begin
  insert into afoot.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Named for Afoot: other apps on this project may add their own sign-up triggers.
drop trigger if exists afoot_on_auth_user_created on auth.users;
create trigger afoot_on_auth_user_created
  after insert on auth.users
  for each row execute function afoot.handle_new_user();

-- "I'm going" to a specific occurrence.
create table if not exists rsvps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  occurrence_id uuid not null references event_occurrences(id) on delete cascade,
  created_at    timestamptz default now(),
  unique (user_id, occurrence_id)
);
create index if not exists idx_rsvps_occ on rsvps(occurrence_id);

-- Request someone's contact; they approve/deny. On approval the requester may
-- read the recipient's phone (via get_shared_contact), never otherwise.
create table if not exists contact_requests (
  id            uuid primary key default gen_random_uuid(),
  occurrence_id uuid references event_occurrences(id) on delete set null,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  message       text,                 -- short note, moderated/reportable
  status        text default 'pending', -- pending | approved | denied
  created_at    timestamptz default now(),
  responded_at  timestamptz,
  unique (requester_id, recipient_id, occurrence_id),
  check (requester_id <> recipient_id)
);
create index if not exists idx_cr_recipient on contact_requests(recipient_id, status);
create index if not exists idx_cr_requester on contact_requests(requester_id, status);

-- Moderation foundation.
create table if not exists blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  subject_id  uuid references auth.users(id) on delete set null, -- reported user
  kind        text,   -- contact_request | message | profile
  ref_id      uuid,   -- id of the offending row
  reason      text,
  status      text default 'open',  -- open | reviewed | actioned
  created_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- nearby_events: upcoming occurrences within a radius of a point.
-- Uses the haversine formula directly so no PostGIS/earthdistance extension
-- is required (keeps the free tier dead simple).
-- ---------------------------------------------------------------------------

-- Return type changed over time (confidence, heads-up tips); drop before recreating.
drop function if exists nearby_events(double precision, double precision, double precision, int);
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
  distance_km            double precision,
  confidence             text,
  uncertain_fields       text[],
  cancelled              boolean,
  heads_up               jsonb      -- {"parking": 3, "great_vibe": 5}, from people who went
)
language sql
stable
set search_path = afoot
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
      )) as distance_km,
      coalesce(r.c, 0) as going_count,
      e.confidence, e.uncertain_fields, o.cancelled,
      coalesce(h.tips, '{}'::jsonb) as heads_up
    from event_occurrences o
    join events e on e.id = o.event_id
    join venues v on v.id = e.venue_id
    left join (
      select occurrence_id, count(*)::bigint as c from rsvps group by occurrence_id
    ) r on r.occurrence_id = o.id
    -- Heads-up tips apply to the whole series (parking doesn't change week to week).
    left join (
      select event_id, jsonb_object_agg(reason, n) as tips
      from (
        select event_id, reason, count(distinct device_hash) as n
        from event_flags where kind = 'heads_up' and status <> 'dismissed'
        group by event_id, reason
      ) t group by event_id
    ) h on h.event_id = e.id
    where v.active
      and e.status = 'active'
      and v.lat is not null
      and v.lng is not null
      and coalesce(o.ends_at, o.starts_at + interval '3 hours') >= now()
      and o.starts_at <= now() + make_interval(days => in_days_ahead)
  )
  select
    occurrence_id, event_id, title, description, category, price, url,
    recurrence_description, is_recurring, tags, starts_at, ends_at,
    venue_id, venue_name, venue_address, venue_lat, venue_lng, distance_km,
    confidence, uncertain_fields, cancelled, heads_up
  from scored
  where distance_km <= in_radius_km
  order by (starts_at at time zone 'America/Los_Angeles')::date asc,
           going_count desc, starts_at asc, distance_km asc;
$$;

-- ---------------------------------------------------------------------------
-- Social RPCs (SECURITY DEFINER so they can read across users, but each one
-- filters by auth.uid() and returns only non-private fields — phone is only
-- ever returned to an approved requester via get_shared_contact).
-- ---------------------------------------------------------------------------

-- Names-only attendee list for an occurrence (no PII). Attendance is private:
-- you only see who's going if YOU are also going (i.e. you're in the chat).
create or replace function occurrence_attendees(in_occurrence_id uuid)
returns table (user_id uuid, display_name text, avatar_url text)
language sql stable security definer set search_path = afoot as $$
  select p.id, coalesce(p.display_name, 'Guest'), p.avatar_url
  from rsvps rs
  join profiles p on p.id = rs.user_id
  where rs.occurrence_id = in_occurrence_id
    and exists (
      select 1 from rsvps me
      where me.occurrence_id = in_occurrence_id and me.user_id = auth.uid()
    )
  order by rs.created_at;
$$;

-- Event chat messages. Only people who RSVP'd ("going") can read or post.
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references event_occurrences(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  body          text not null,
  created_at    timestamptz default now()
);
create index if not exists idx_messages_occ on messages(occurrence_id, created_at);

-- Chat messages for an occurrence: gated on the caller being going, and hiding
-- anyone the caller has blocked. (SECURITY DEFINER but filtered by auth.uid().)
create or replace function occurrence_messages(in_occurrence_id uuid)
returns table (id uuid, user_id uuid, display_name text, body text, created_at timestamptz)
language sql stable security definer set search_path = afoot as $$
  select m.id, m.user_id, coalesce(p.display_name, 'Guest'), m.body, m.created_at
  from messages m
  join profiles p on p.id = m.user_id
  where m.occurrence_id = in_occurrence_id
    and exists (
      select 1 from rsvps me
      where me.occurrence_id = in_occurrence_id and me.user_id = auth.uid()
    )
    and not exists (
      select 1 from blocks b where b.blocker_id = auth.uid() and b.blocked_id = m.user_id
    )
  order by m.created_at;
$$;

-- Contact requests addressed to me (with requester name), hiding blocked users.
create or replace function incoming_contact_requests()
returns table (id uuid, requester_id uuid, requester_name text, occurrence_id uuid, message text, status text, created_at timestamptz)
language sql stable security definer set search_path = afoot as $$
  select cr.id, cr.requester_id, coalesce(p.display_name, 'Someone'),
         cr.occurrence_id, cr.message, cr.status, cr.created_at
  from contact_requests cr
  join profiles p on p.id = cr.requester_id
  where cr.recipient_id = auth.uid()
    and not exists (select 1 from blocks b where b.blocker_id = auth.uid() and b.blocked_id = cr.requester_id)
  order by cr.created_at desc;
$$;

-- My outgoing requests; phone is included only when approved and shared.
create or replace function outgoing_contact_requests()
returns table (id uuid, recipient_id uuid, recipient_name text, occurrence_id uuid, status text, shared_phone text, created_at timestamptz)
language sql stable security definer set search_path = afoot as $$
  select cr.id, cr.recipient_id, coalesce(p.display_name, 'Someone'),
         cr.occurrence_id, cr.status,
         case when cr.status = 'approved' and p.share_phone then p.phone else null end,
         cr.created_at
  from contact_requests cr
  join profiles p on p.id = cr.recipient_id
  where cr.requester_id = auth.uid()
  order by cr.created_at desc;
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

-- Account/social tables: users act only on their own rows.
alter table profiles         enable row level security;
alter table rsvps            enable row level security;
alter table contact_requests enable row level security;
alter table blocks           enable row level security;
alter table reports          enable row level security;

drop policy if exists "profile read own"   on profiles;
drop policy if exists "profile insert own" on profiles;
drop policy if exists "profile update own" on profiles;
create policy "profile read own"   on profiles for select using (auth.uid() = id);
create policy "profile insert own" on profiles for insert with check (auth.uid() = id);
create policy "profile update own" on profiles for update using (auth.uid() = id);

drop policy if exists "rsvp read own"   on rsvps;
drop policy if exists "rsvp insert own" on rsvps;
drop policy if exists "rsvp delete own" on rsvps;
create policy "rsvp read own"   on rsvps for select using (auth.uid() = user_id);
create policy "rsvp insert own" on rsvps for insert with check (auth.uid() = user_id);
create policy "rsvp delete own" on rsvps for delete using (auth.uid() = user_id);

drop policy if exists "cr read involved"     on contact_requests;
drop policy if exists "cr insert requester"  on contact_requests;
drop policy if exists "cr update recipient"  on contact_requests;
create policy "cr read involved"    on contact_requests for select using (auth.uid() = requester_id or auth.uid() = recipient_id);
create policy "cr insert requester" on contact_requests for insert with check (auth.uid() = requester_id);
create policy "cr update recipient" on contact_requests for update using (auth.uid() = recipient_id);

drop policy if exists "blocks own" on blocks;
create policy "blocks own" on blocks for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

drop policy if exists "reports insert own" on reports;
create policy "reports insert own" on reports for insert with check (auth.uid() = reporter_id);
-- reports are reviewed via the service role (admin); no public read.

-- Event chat: read/post only if you RSVP'd to that occurrence.
alter table messages enable row level security;
drop policy if exists "messages read if going"   on messages;
drop policy if exists "messages insert if going" on messages;
create policy "messages read if going" on messages for select using (
  exists (select 1 from rsvps r where r.occurrence_id = messages.occurrence_id and r.user_id = auth.uid())
);
create policy "messages insert if going" on messages for insert with check (
  user_id = auth.uid()
  and exists (select 1 from rsvps r where r.occurrence_id = messages.occurrence_id and r.user_id = auth.uid())
);

-- Feedback is written and read only by the server (service role), which hashes device
-- ids and rate-limits; no direct browser access.
alter table event_flags  enable row level security;
alter table event_checks enable row level security;

-- ---------------------------------------------------------------------------
-- Access for Supabase's API roles. A custom schema gets none of the defaults that
-- `public` has, so grant explicitly. RLS above still decides which rows each role sees.
-- ---------------------------------------------------------------------------
grant usage on schema afoot to anon, authenticated, service_role;
grant all on all tables    in schema afoot to service_role;
grant all on all sequences in schema afoot to service_role;
grant all on all functions in schema afoot to service_role;
grant select on venues, events, event_occurrences to anon, authenticated;
grant select, insert, update on profiles to authenticated;
grant select, insert, delete on rsvps to authenticated;
grant select, insert, update on contact_requests to authenticated;
grant select, insert, delete on blocks to authenticated;
grant insert on reports to authenticated;
grant select, insert on messages to authenticated;
grant execute on function nearby_events(double precision, double precision, double precision, int) to anon, authenticated;
grant execute on function occurrence_attendees(uuid), occurrence_messages(uuid),
  incoming_contact_requests(), outgoing_contact_requests() to authenticated;
alter default privileges in schema afoot grant all on tables to service_role;
alter default privileges in schema afoot grant all on functions to service_role;

-- ===========================================================================
-- Sponsors, campaigns and their daily counts (Afoot Sponsorship Playbook, section 9).
-- Also in supabase/migrations/20261023120000_sponsor_campaigns.sql, to apply on its own.
-- Server-only: RLS is on with no anon/authenticated policies, so only the service role
-- (route handlers, scripts) can read or write these tables.
--
-- Privacy: campaign_daily holds counts and nothing else. No cookies, IPs, device ids
-- or user agents are stored anywhere for ads.
-- ===========================================================================
-- A business that pays for placement. Stripe holds card details; we keep only the
-- customer id so a later webhook can match payments to the sponsor.
create table if not exists afoot.sponsors (
  id                 uuid primary key default gen_random_uuid(),
  business_name      text not null,
  contact_name       text,
  contact_email      text,
  stripe_customer_id text,
  notes              text,
  created_at         timestamptz default now()
);

-- One sold placement: an area sponsor card, or a featured (pinned) event.
--   area: a launch-area name from lib/areas.ts, or 'all' (validated by the admin API,
--   not here, so adding an area never needs a migration).
create table if not exists afoot.campaigns (
  id          uuid primary key default gen_random_uuid(),
  sponsor_id  uuid not null references afoot.sponsors(id) on delete cascade,
  product     text not null check (product in ('area_sponsor', 'featured_event')),
  area        text not null default 'all',
  event_id    uuid references afoot.events(id) on delete set null,  -- featured_event only
  starts_on   date not null,
  ends_on     date not null,
  badge       text,
  title       text not null,
  body        text,
  cta         text,
  href        text not null,
  status      text not null default 'draft'
              check (status in ('draft', 'approved', 'live', 'paused', 'ended')),
  price_cents int check (price_cents is null or price_cents >= 0),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  check (ends_on >= starts_on)
);
create index if not exists idx_campaigns_live on afoot.campaigns(status, starts_on, ends_on);
create index if not exists idx_campaigns_sponsor on afoot.campaigns(sponsor_id);

-- Views and clicks per campaign per Los Angeles calendar day. Counts only.
create table if not exists afoot.campaign_daily (
  campaign_id uuid not null references afoot.campaigns(id) on delete cascade,
  day         date not null,
  views       int not null default 0,
  clicks      int not null default 0,
  primary key (campaign_id, day)
);

-- Atomic +n for today's row (one statement, so concurrent bumps never lose a count).
-- Security invoker: it runs with the caller's rights, and only the service role may call it.
create or replace function afoot.bump_campaign(p_campaign uuid, p_views int default 0, p_clicks int default 0)
returns void
language sql
set search_path = afoot
as $$
  insert into afoot.campaign_daily (campaign_id, day, views, clicks)
  values (p_campaign, (now() at time zone 'America/Los_Angeles')::date,
          greatest(coalesce(p_views, 0), 0), greatest(coalesce(p_clicks, 0), 0))
  on conflict (campaign_id, day) do update
    set views  = afoot.campaign_daily.views  + excluded.views,
        clicks = afoot.campaign_daily.clicks + excluded.clicks;
$$;

alter table afoot.sponsors       enable row level security;
alter table afoot.campaigns      enable row level security;
alter table afoot.campaign_daily enable row level security;
-- No policies on purpose: anon/authenticated see nothing; the service role bypasses RLS.

revoke all on afoot.sponsors, afoot.campaigns, afoot.campaign_daily from anon, authenticated;
grant all on afoot.sponsors, afoot.campaigns, afoot.campaign_daily to service_role;
-- Functions are executable by PUBLIC by default; counting is server-only.
revoke execute on function afoot.bump_campaign(uuid, int, int) from public, anon, authenticated;
grant execute on function afoot.bump_campaign(uuid, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- Event links and feeds (migration 20261029010000_event_links_and_feeds.sql)
-- ---------------------------------------------------------------------------
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
