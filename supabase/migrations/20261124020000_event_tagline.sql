-- Short tagline per event (under 10 words, never repeating the title, venue or date), written by
-- the extraction model and shown in place of the description on phones.
alter table afoot.events add column if not exists tagline text;

-- The return shape changes, so the function is dropped and recreated (same body, plus tagline).
drop function if exists afoot.nearby_events(double precision, double precision, double precision, integer);

create function afoot.nearby_events(in_lat double precision, in_lng double precision, in_radius_km double precision default 15, in_days_ahead integer default 30)
 returns table(occurrence_id uuid, event_id uuid, title text, description text, category text, price text, price_is_usual boolean, url text, recurrence_description text, is_recurring boolean, tags text[], starts_at timestamp with time zone, ends_at timestamp with time zone, venue_id uuid, venue_name text, venue_address text, venue_lat double precision, venue_lng double precision, venue_parking text, venue_good_to_know text, distance_km double precision, traffic_score smallint, confidence text, uncertain_fields text[], cancelled boolean, heads_up jsonb, tagline text)
 language sql
 stable
 set search_path to 'afoot'
as $function$
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
      e.traffic_score,
      e.confidence, e.uncertain_fields, o.cancelled,
      coalesce(h.tips, '{}'::jsonb) as heads_up,
      e.tagline
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
    distance_km, traffic_score, confidence, uncertain_fields, cancelled, heads_up, tagline
  from scored
  where distance_km <= in_radius_km
  order by (starts_at at time zone 'America/Los_Angeles')::date asc,
           traffic_score desc nulls last, going_count desc, starts_at asc, distance_km asc;
$function$;

grant execute on function afoot.nearby_events(double precision, double precision, double precision, integer) to anon, authenticated, service_role;
