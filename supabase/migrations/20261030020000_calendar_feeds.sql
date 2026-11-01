-- ===========================================================================
-- Official calendar feeds (lib/calendarFeeds.ts): iCalendar URLs and Localist calendars of
-- colleges, libraries, parks departments, museums and malls, pulled daily with the other feeds.
-- Same statements as the "Calendar feeds" block at the end of supabase/schema.sql; safe to re-run.
--   venue_id     where events without their own map pin are listed (the campus, the library)
--   source_type  which kind of place it is, for the coverage list (data/sources/README.md)
--   options      { include, exclude (regexes), days, public_only, max }
-- ===========================================================================

alter table afoot.event_feeds drop constraint if exists event_feeds_kind_check;
alter table afoot.event_feeds add constraint event_feeds_kind_check
  check (kind in ('eventbrite_organizer', 'ticketmaster_venue', 'ics', 'localist'));
alter table afoot.event_feeds add column if not exists venue_id uuid references afoot.venues(id) on delete set null;
alter table afoot.event_feeds add column if not exists source_type text;
alter table afoot.event_feeds add column if not exists options jsonb not null default '{}'::jsonb;
