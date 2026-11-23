-- ===========================================================================
-- Ranking formula (npm run rank, nightly, no AI): each venue has a draw (1–100), started from its
-- Wikipedia page views and refreshed weekly; each event's traffic_score is plain arithmetic on the
-- venue draw, the event's own facts and its recent taps.
-- event_daily: views and taps per event per Los Angeles day. Counts only: no cookies, IPs,
-- device ids or user agents are stored.
-- ===========================================================================

alter table afoot.venues add column if not exists draw smallint check (draw between 1 and 100);
alter table afoot.venues add column if not exists draw_source text;          -- wikipedia | default | manual (never overwritten)
alter table afoot.venues add column if not exists wiki_title text;
alter table afoot.venues add column if not exists wiki_views int;            -- average monthly page views
alter table afoot.venues add column if not exists draw_updated_at timestamptz;

create table if not exists afoot.event_daily (
  event_id uuid not null references afoot.events(id) on delete cascade,
  day      date not null,
  views    int not null default 0,   -- card at least half on screen, once per page view
  clicks   int not null default 0,   -- taps through to the event's page
  primary key (event_id, day)
);
create index if not exists idx_event_daily_day on afoot.event_daily(day);
alter table afoot.event_daily enable row level security;
revoke all on afoot.event_daily from anon, authenticated;
grant all on afoot.event_daily to service_role;

-- One call per beacon: +1 view / +1 click for each id (ids are de-duplicated by the API).
create or replace function afoot.bump_event_daily(p_views uuid[], p_clicks uuid[])
returns void
language sql
set search_path = afoot
as $$
  insert into afoot.event_daily (event_id, day, views, clicks)
  select e.id, (now() at time zone 'America/Los_Angeles')::date,
         (e.id = any(coalesce(p_views, '{}')))::int,
         (e.id = any(coalesce(p_clicks, '{}')))::int
  from afoot.events e
  where e.id = any(coalesce(p_views, '{}')) or e.id = any(coalesce(p_clicks, '{}'))
  on conflict (event_id, day) do update
    set views  = afoot.event_daily.views  + excluded.views,
        clicks = afoot.event_daily.clicks + excluded.clicks;
$$;

-- One call to save many scores: [{ "id": uuid, "score": 1-100 }]. Returns rows changed.
create or replace function afoot.set_traffic_scores(p jsonb)
returns int
language sql
set search_path = afoot
as $$
  with s as (
    select (x->>'id')::uuid as id, greatest(1, least(100, (x->>'score')::int))::smallint as score
    from jsonb_array_elements(p) x
  ), u as (
    update afoot.events e set traffic_score = s.score, traffic_scored_at = now()
    from s where e.id = s.id and e.traffic_score is distinct from s.score
    returning 1
  )
  select count(*)::int from u;
$$;

revoke execute on function afoot.bump_event_daily(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function afoot.bump_event_daily(uuid[], uuid[]) to service_role;
revoke execute on function afoot.set_traffic_scores(jsonb) from public, anon, authenticated;
grant execute on function afoot.set_traffic_scores(jsonb) to service_role;
