-- ===========================================================================
-- Founder queue (/admin/queue) and the founder emails (npm run digest).
--   * venues.default_price: one price for a venue's events that have none (e.g. "Free" for a library)
--   * venues.outreach_*: a spreadsheet-simple record of pitching each venue
--   * founder_settings: the editable ranking prompt and the AI's weekly plan
--   * founder_actions / founder_emails / founder_alerts: what was fixed and what was sent
-- Server-only: RLS on with no policies, so only the service role reads or writes these.
-- ===========================================================================

alter table afoot.venues add column if not exists default_price text;
alter table afoot.venues add column if not exists outreach_status text not null default 'not_contacted';
alter table afoot.venues drop constraint if exists venues_outreach_status_check;
alter table afoot.venues add constraint venues_outreach_status_check
  check (outreach_status in ('not_contacted', 'contacted', 'talking', 'paying', 'declined'));
alter table afoot.venues add column if not exists outreach_count int not null default 0;
alter table afoot.venues add column if not exists outreach_last_at timestamptz;
alter table afoot.venues add column if not exists outreach_notes text;
-- "Skip" on a queue card hides that venue's cards until this time.
alter table afoot.venues add column if not exists queue_skip_until timestamptz;

-- Re-imports send price = null for most feeds. Keep a price we already know, else use the
-- venue's default, so a fill made in the queue survives the nightly import.
create or replace function afoot.keep_event_price() returns trigger
language plpgsql set search_path = afoot as $$
begin
  if new.price is null or btrim(new.price) = '' then
    new.price := null;
    if tg_op = 'UPDATE' then
      new.price := nullif(btrim(old.price), '');
    end if;
    if new.price is null then
      select nullif(btrim(v.default_price), '') into new.price from afoot.venues v where v.id = new.venue_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists keep_event_price on afoot.events;
create trigger keep_event_price before insert or update on afoot.events
  for each row execute function afoot.keep_event_price();

create table if not exists afoot.founder_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

create table if not exists afoot.founder_actions (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,          -- address | price | skip | outreach
  venue_id   uuid references afoot.venues(id) on delete set null,
  detail     text,
  dates      int default 0,          -- upcoming dates the fill fixed
  created_at timestamptz default now()
);
create index if not exists idx_founder_actions_at on afoot.founder_actions(created_at desc);

create table if not exists afoot.founder_emails (
  id      uuid primary key default gen_random_uuid(),
  kind    text not null,             -- monday | thursday | saturday | alert
  la_day  date not null,             -- the Los Angeles calendar day it was for (one per kind per day)
  subject text,
  body    text,
  error   text,
  sent_at timestamptz default now(),
  unique (kind, la_day)
);

-- Events already sent as "please research this" so they're asked about once.
create table if not exists afoot.founder_alerts (
  event_id uuid primary key references afoot.events(id) on delete cascade,
  sent_at  timestamptz default now()
);

alter table afoot.founder_settings enable row level security;
alter table afoot.founder_actions  enable row level security;
alter table afoot.founder_emails   enable row level security;
alter table afoot.founder_alerts   enable row level security;

insert into afoot.founder_settings (key, value) values ('ranking_prompt',
'Rank by traffic potential: how many people in LA would want to go, search for it, or share it.
An event with a name and a link is worth showing even when other details are missing.
The fields that matter, in order: name and link, address, cost, map location.
Never hold an event back because it is soon. If a high-traffic event is soon and missing details, ask Miguel to research it by hand.
Prefer fixes that complete many dates at once (one venue address or venue-wide price).
For in-person promotion, pick venues that have not said yes (paying) or no yet, clustered so one trip covers several.')
on conflict (key) do nothing;
