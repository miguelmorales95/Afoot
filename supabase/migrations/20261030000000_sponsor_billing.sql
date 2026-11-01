-- ===========================================================================
-- Sponsor billing with Stripe (Afoot Sponsorship Playbook, section 7). Same statements as the
-- "Sponsor billing" block at the end of supabase/schema.sql; safe to re-run.
--
-- A campaign is paid through a Stripe payment link (monthly, or one payment) or a Stripe invoice
-- (net 15). Stripe holds every card and bank detail; Afoot keeps only Stripe's ids and where the
-- payment stands. stripe_events remembers which webhook events were handled, so a retried event
-- never applies twice.
-- ===========================================================================

alter table afoot.campaigns add column if not exists billing text not null default 'monthly';
alter table afoot.campaigns add column if not exists billing_status text not null default 'unbilled';
alter table afoot.campaigns add column if not exists stripe_payment_link_id text;
alter table afoot.campaigns add column if not exists stripe_payment_link_url text;
alter table afoot.campaigns add column if not exists stripe_subscription_id text;
alter table afoot.campaigns add column if not exists stripe_invoice_id text;
alter table afoot.campaigns add column if not exists stripe_invoice_url text;
alter table afoot.campaigns add column if not exists paid_at timestamptz;

do $$ begin
  alter table afoot.campaigns add constraint campaigns_billing_check check (billing in ('monthly', 'once'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- unbilled -> link_sent | invoiced -> paid (one payment) | active (monthly) -> past_due -> canceled
  alter table afoot.campaigns add constraint campaigns_billing_status_check
    check (billing_status in ('unbilled', 'link_sent', 'invoiced', 'paid', 'active', 'past_due', 'canceled'));
exception when duplicate_object then null; end $$;

-- Featured events are a one-off purchase.
update afoot.campaigns set billing = 'once' where product = 'featured_event' and billing_status = 'unbilled';

create index if not exists idx_campaigns_subscription on afoot.campaigns(stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists afoot.stripe_events (
  id          text primary key,   -- Stripe's event id (evt_…)
  type        text not null,
  received_at timestamptz default now()
);
alter table afoot.stripe_events enable row level security;
revoke all on afoot.stripe_events from anon, authenticated;
grant all on afoot.stripe_events to service_role;
