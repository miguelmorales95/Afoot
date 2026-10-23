-- Afoot schema. Run this in the Supabase SQL editor (or `supabase db push`).
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
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

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
      )) as distance_km,
      coalesce(r.c, 0) as going_count
    from event_occurrences o
    join events e on e.id = o.event_id
    join venues v on v.id = e.venue_id
    left join (
      select occurrence_id, count(*)::bigint as c from rsvps group by occurrence_id
    ) r on r.occurrence_id = o.id
    where v.active
      and v.lat is not null
      and v.lng is not null
      and o.starts_at >= now()
      and o.starts_at <= now() + make_interval(days => in_days_ahead)
  )
  -- going_count is intentionally NOT returned (attendance is private). It is
  -- used only to rank events: more-popular events surface higher within a day.
  select
    occurrence_id, event_id, title, description, category, price, url,
    recurrence_description, is_recurring, tags, starts_at, ends_at,
    venue_id, venue_name, venue_address, venue_lat, venue_lng, distance_km
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
language sql stable security definer set search_path = public as $$
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
language sql stable security definer set search_path = public as $$
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
language sql stable security definer set search_path = public as $$
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
language sql stable security definer set search_path = public as $$
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
