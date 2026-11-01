-- ===========================================================================
-- Two more official calendar kinds (lib/calendarFeeds.ts):
--   civicplus  a CivicPlus city calendar's RSS (dates, times and place for each event)
--   communico  a Communico library calendar (https://library.libnet.info), read from its events JSON
-- Same statements as the end of supabase/schema.sql; safe to re-run.
-- ===========================================================================

alter table afoot.event_feeds drop constraint if exists event_feeds_kind_check;
alter table afoot.event_feeds add constraint event_feeds_kind_check
  check (kind in ('eventbrite_organizer', 'ticketmaster_venue', 'ics', 'localist', 'civicplus', 'communico'));
