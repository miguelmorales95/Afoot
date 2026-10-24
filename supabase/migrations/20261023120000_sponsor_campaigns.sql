-- ===========================================================================
-- Sponsors, campaigns and their daily counts (Afoot Sponsorship Playbook, section 9).
-- Same statements as the "Sponsors" block at the end of supabase/schema.sql; safe to
-- re-run. Server-only: RLS is on with no anon/authenticated policies, so only the
-- service role (route handlers, scripts) can read or write these tables.
--
-- Privacy: campaign_daily holds counts and nothing else. No cookies, IPs, device ids
-- or user agents are stored anywhere for ads.
-- ===========================================================================

create schema if not exists afoot;

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
