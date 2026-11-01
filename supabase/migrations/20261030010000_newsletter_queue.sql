-- ===========================================================================
-- Newsletter queue. The inbound-email webhook now only saves each email; the daily GitHub
-- Actions job matches it to a venue and reads its events (lib/newsletter.ts). Saving the HTML
-- keeps the links that identify the venue. Same statements as the "Newsletter queue" block at the
-- end of supabase/schema.sql; safe to re-run.
--
-- inbound_emails.status: queued -> processed | unmatched | error, or needs_confirm (a
-- "confirm your subscription" email: its links are in note, for /admin → Newsletters), or ignored.
-- ===========================================================================

alter table afoot.inbound_emails add column if not exists body_html text;
create index if not exists idx_inbound_emails_status on afoot.inbound_emails(status, received_at);

-- Newsletter signup pages for venues whose calendars can't be read (found 2026-10-30 on their own
-- sites). Subscribe the Afoot inbox to each; /admin → Newsletters lists them until one arrives.
update afoot.venues set newsletter_url = v.url from (values
  ('alex-s-bar',                      'https://alexsbar.com/pages/newsletter'),
  ('highland-park-brewery-chinatown', 'https://hpb.us10.list-manage.com/subscribe?u=0bcd0c19f05b97aad7b59cb3c&id=188120fa27'),
  ('lyric-hyperion',                  'https://lyrichyperion.com/'),
  ('the-hotel-cafe',                  'https://hotelcafe.us5.list-manage.com/subscribe?u=6b17f569807925b601a9e5bd3&id=fdbf5ba881'),
  ('the-world-stage',                 'https://theworldstage.us14.list-manage.com/subscribe?u=ebf98418551a1749b333e016c&id=1ec5ac281f'),
  ('absolution-brewing-company',      'https://absolutionbrewingcompany.us14.list-manage.com/subscribe?u=76bf62087e10ef79b33db63cf&id=f9576bafde'),
  ('village-well-books-coffee',       'https://villagewell.com/'),
  ('arts-district-brewing',           'https://www.artsdistrictbrewing.com/'),
  ('the-last-bookstore',              'https://www.lastbookstorela.com/')
) as v(slug, url)
where afoot.venues.slug = v.slug and afoot.venues.newsletter_url is null;
