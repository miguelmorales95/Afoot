-- Crowdsourced start times. When a page gives no time (card says "TIME TBA"), visitors can say
-- when it starts; two matching answers set events.confirmed_time, which the nightly import uses
-- in place of its 7 PM placeholder.
alter table afoot.event_checks add column if not exists value text;
alter table afoot.event_checks drop constraint if exists event_checks_answer_check;
alter table afoot.event_checks add constraint event_checks_answer_check check (answer in ('yes', 'no', 'unsure', 'value'));

-- "HH:MM" in LA time, confirmed by visitors.
alter table afoot.events add column if not exists confirmed_time text;
