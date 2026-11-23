-- ===========================================================================
-- Venue guide: what a venue usually charges (venues.default_price), parking, and other
-- good-to-know notes. The event's own post always wins; the guide fills in only when the
-- post doesn't say, and the site labels that price as usual ("usually Free").
--
-- Also moves outreach tracking off `venues` (the public can read venues) into a
-- server-only table.
-- ===========================================================================

create table if not exists afoot.venue_outreach (
  venue_id   uuid primary key references afoot.venues(id) on delete cascade,
  status     text not null default 'not_contacted'
             check (status in ('not_contacted', 'contacted', 'talking', 'paying', 'declined')),
  contacts   int not null default 0,
  last_at    timestamptz,
  notes      text,
  skip_until timestamptz,             -- "Skip a week" on a queue card
  updated_at timestamptz default now()
);
alter table afoot.venue_outreach enable row level security;

insert into afoot.venue_outreach (venue_id, status, contacts, last_at, notes, skip_until)
  select id, outreach_status, outreach_count, outreach_last_at, outreach_notes, queue_skip_until
  from afoot.venues
  where outreach_status <> 'not_contacted' or outreach_count > 0 or outreach_notes is not null or queue_skip_until is not null
on conflict (venue_id) do nothing;

alter table afoot.venues drop constraint if exists venues_outreach_status_check;
alter table afoot.venues drop column if exists outreach_status;
alter table afoot.venues drop column if exists outreach_count;
alter table afoot.venues drop column if exists outreach_last_at;
alter table afoot.venues drop column if exists outreach_notes;
alter table afoot.venues drop column if exists queue_skip_until;

alter table afoot.venues add column if not exists parking text;
alter table afoot.venues add column if not exists good_to_know text;
comment on column afoot.venues.default_price is 'Usual price, used only when an event''s own post gives none';

-- An event keeps the last price its own post gave when a re-import has none. The venue's
-- usual price is never copied in; nearby_events falls back to it when reading.
create or replace function afoot.keep_event_price() returns trigger
language plpgsql set search_path = afoot as $$
begin
  if new.price is null or btrim(new.price) = '' then
    new.price := case when tg_op = 'UPDATE' then nullif(btrim(old.price), '') end;
  end if;
  return new;
end $$;

drop function if exists afoot.nearby_events(double precision, double precision, double precision, int);
create function afoot.nearby_events(
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
  price_is_usual         boolean,    -- price is the venue's usual price, not from the event's post
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
  venue_parking          text,
  venue_good_to_know     text,
  distance_km            double precision,
  confidence             text,
  uncertain_fields       text[],
  cancelled              boolean,
  heads_up               jsonb
)
language sql
stable
set search_path = afoot
as $$
  with scored as (
    select
      o.id as occurrence_id,
      e.id as event_id,
      e.title, e.description, e.category,
      coalesce(nullif(btrim(e.price), ''), nullif(btrim(v.default_price), '')) as price,
      (nullif(btrim(e.price), '') is null and nullif(btrim(v.default_price), '') is not null) as price_is_usual,
      e.url, e.recurrence_description, e.is_recurring, e.tags,
      o.starts_at, o.ends_at,
      v.id as venue_id, v.name as venue_name, v.address as venue_address,
      v.lat as venue_lat, v.lng as venue_lng, v.parking as venue_parking, v.good_to_know as venue_good_to_know,
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
    occurrence_id, event_id, title, description, category, price, price_is_usual, url,
    recurrence_description, is_recurring, tags, starts_at, ends_at,
    venue_id, venue_name, venue_address, venue_lat, venue_lng, venue_parking, venue_good_to_know,
    distance_km, confidence, uncertain_fields, cancelled, heads_up
  from scored
  where distance_km <= in_radius_km
  order by (starts_at at time zone 'America/Los_Angeles')::date asc,
           going_count desc, starts_at asc, distance_km asc;
$$;
grant execute on function afoot.nearby_events(double precision, double precision, double precision, int) to anon, authenticated, service_role;
