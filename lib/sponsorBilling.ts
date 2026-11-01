// Getting paid by sponsors with Stripe (Sponsorship Playbook, section 7). Server-only.
//
//   Payment link: a Stripe page the sponsor pays on, monthly (a subscription that stops on the
//     campaign's end date) or one payment. Links don't expire, so they can go out with the IO.
//   Invoice: one Stripe invoice for the campaign's price, emailed by Stripe, due in 15 days.
//
// Stripe tells us what happened through the webhook (app/api/stripe/webhook): paid campaigns that
// are approved go live, and a monthly campaign whose payments stop is paused. Afoot stores only
// Stripe's ids; Stripe holds every card and bank detail.
//
// Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET. Without them billing is "not set up".
import Stripe from "stripe";
import { supabase } from "./supabase";
import { todayLA } from "./campaigns";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://afoot.somedude.app";
export const NOT_SET_UP = "Stripe isn't set up: add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Vercel.";

let client: Stripe | null = null;
export function stripe(): Stripe | null {
  if (!client && process.env.STRIPE_SECRET_KEY) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

export type Billing = "monthly" | "once";
export type BillingStatus = "unbilled" | "link_sent" | "invoiced" | "paid" | "active" | "past_due" | "canceled";

interface BillableCampaign {
  id: string;
  sponsor_id: string;
  product: "area_sponsor" | "featured_event";
  area: string;
  starts_on: string;
  ends_on: string;
  title: string;
  price_cents: number | null;
  billing: Billing;
  stripe_payment_link_id: string | null;
}

interface SponsorRow { id: string; business_name: string; contact_email: string | null; stripe_customer_id: string | null }

const PRODUCT_NAME = { area_sponsor: "Afoot area sponsor card", featured_event: "Afoot featured event" };

function describe(c: BillableCampaign) {
  const area = c.area === "all" ? "all areas" : c.area;
  return `${PRODUCT_NAME[c.product]} · ${area} · ${c.starts_on} to ${c.ends_on} · “${c.title}”`;
}

async function load(campaignId: string) {
  const { data: c, error } = await supabase.from("campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (error || !c) throw new Error("No such campaign.");
  const { data: s } = await supabase.from("sponsors").select("id, business_name, contact_email, stripe_customer_id").eq("id", c.sponsor_id).single();
  if (!c.price_cents || c.price_cents < 50) throw new Error("Set the campaign's price first (at least $0.50).");
  return { c: c as BillableCampaign, s: s as SponsorRow };
}

/** A Stripe payment link for the campaign (made once; the same link is returned again). */
export async function paymentLinkFor(campaignId: string): Promise<string> {
  const st = stripe();
  if (!st) throw new Error(NOT_SET_UP);
  const { c, s } = await load(campaignId);
  if (c.stripe_payment_link_id) {
    const existing = await st.paymentLinks.retrieve(c.stripe_payment_link_id);
    if (existing.active) return existing.url;
  }
  const monthly = c.billing === "monthly";
  const price = await st.prices.create({
    currency: "usd",
    unit_amount: c.price_cents!,
    product_data: { name: `${PRODUCT_NAME[c.product]} for ${s.business_name}` },
    ...(monthly ? { recurring: { interval: "month" as const } } : {}),
  });
  const metadata = { campaign_id: c.id, sponsor_id: s.id };
  const link = await st.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    ...(monthly
      ? { subscription_data: { metadata, description: describe(c) } }
      : { payment_intent_data: { metadata, description: describe(c) }, invoice_creation: { enabled: true, invoice_data: { metadata, description: describe(c) } } }),
    restrictions: { completed_sessions: { limit: 1 } },
    after_completion: { type: "redirect", redirect: { url: `${SITE_URL}/?sponsor=thanks` } },
  });
  await supabase.from("campaigns").update({
    stripe_payment_link_id: link.id, stripe_payment_link_url: link.url, billing_status: "link_sent", updated_at: new Date().toISOString(),
  }).eq("id", c.id);
  return link.url;
}

/** One Stripe invoice for the campaign's price, emailed to the sponsor, due in 15 days. */
export async function sendInvoiceFor(campaignId: string): Promise<string> {
  const st = stripe();
  if (!st) throw new Error(NOT_SET_UP);
  const { c, s } = await load(campaignId);
  if (!s.contact_email) throw new Error("Add the sponsor's contact email first: Stripe emails the invoice there.");
  let customer = s.stripe_customer_id;
  if (!customer) {
    customer = (await st.customers.create({ name: s.business_name, email: s.contact_email, metadata: { sponsor_id: s.id } })).id;
    await supabase.from("sponsors").update({ stripe_customer_id: customer }).eq("id", s.id);
  }
  const metadata = { campaign_id: c.id, sponsor_id: s.id };
  const invoice = await st.invoices.create({
    customer, collection_method: "send_invoice", days_until_due: 15, metadata, description: describe(c), auto_advance: true,
  });
  await st.invoiceItems.create({ customer, invoice: invoice.id, amount: c.price_cents!, currency: "usd", description: describe(c) });
  const finalized = await st.invoices.finalizeInvoice(invoice.id!);
  await st.invoices.sendInvoice(finalized.id!);
  await supabase.from("campaigns").update({
    stripe_invoice_id: finalized.id, stripe_invoice_url: finalized.hosted_invoice_url ?? null, billing_status: "invoiced", updated_at: new Date().toISOString(),
  }).eq("id", c.id);
  return finalized.hosted_invoice_url ?? "";
}

// --- Webhook ------------------------------------------------------------------------------

/** End of the campaign's last day in Los Angeles, as a Unix time (when a monthly plan stops). */
function endOfDayLA(date: string): number {
  // LA is UTC-7 or UTC-8; 08:00 UTC the next day is midnight-or-later in LA either way.
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return Math.floor(next.getTime() / 1000) + 8 * 3600;
}

async function campaignBy(field: "id" | "stripe_subscription_id", value: string | null | undefined) {
  if (!value) return null;
  const { data } = await supabase.from("campaigns").select("id, sponsor_id, status, billing, ends_on, stripe_payment_link_id").eq(field, value).maybeSingle();
  return data;
}

async function setCampaign(id: string, patch: Record<string, unknown>) {
  await supabase.from("campaigns").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

/** A paid campaign that was approved goes live; drafts wait for the card to be approved. */
const liveIfApproved = (status: string) => (status === "approved" ? { status: "live" } : {});

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null);

/** Handles one verified Stripe event. Returns false when it was already handled. */
export async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  const { data: seen } = await supabase.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return false;
  await applyStripeEvent(event);
  // Recorded only once handled, so an event that failed halfway is applied again on Stripe's retry.
  await supabase.from("stripe_events").insert({ id: event.id, type: event.type });
  return true;
}

/** Campaign id that Stripe carries on an invoice: our own, or the subscription's. */
const invoiceCampaignId = (inv: Stripe.Invoice) =>
  inv.metadata?.campaign_id ?? inv.parent?.subscription_details?.metadata?.campaign_id ?? null;

async function applyStripeEvent(event: Stripe.Event): Promise<void> {
  const st = stripe()!;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const c = await campaignBy("id", session.metadata?.campaign_id);
    if (!c || session.payment_status === "unpaid") return;
    const customer = idOf(session.customer);
    if (customer) await supabase.from("sponsors").update({ stripe_customer_id: customer }).eq("id", c.sponsor_id).is("stripe_customer_id", null);
    const subscription = idOf(session.subscription);
    if (subscription) {
      // Monthly billing stops after the campaign's last day, without a partial-month refund or charge.
      await st.subscriptions.update(subscription, { cancel_at: endOfDayLA(c.ends_on), proration_behavior: "none" });
    }
    if (c.stripe_payment_link_id) await st.paymentLinks.update(c.stripe_payment_link_id, { active: false });
    await setCampaign(c.id, {
      billing_status: subscription ? "active" : "paid", stripe_subscription_id: subscription, paid_at: new Date().toISOString(), ...liveIfApproved(c.status),
    });
  } else if (event.type === "invoice.paid") {
    const inv = event.data.object as Stripe.Invoice;
    const sub = idOf(inv.parent?.subscription_details?.subscription);
    const c = (await campaignBy("id", invoiceCampaignId(inv))) ?? (await campaignBy("stripe_subscription_id", sub));
    if (c) await setCampaign(c.id, { billing_status: sub ? "active" : "paid", paid_at: new Date().toISOString(), ...(sub ? { stripe_subscription_id: sub } : {}), ...liveIfApproved(c.status) });
  } else if (event.type === "invoice.payment_failed") {
    // Stripe retries and emails the business; the card keeps showing until the retries run out.
    const inv = event.data.object as Stripe.Invoice;
    const c = (await campaignBy("id", invoiceCampaignId(inv))) ?? (await campaignBy("stripe_subscription_id", idOf(inv.parent?.subscription_details?.subscription)));
    if (c) await setCampaign(c.id, { billing_status: "past_due" });
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const c = (await campaignBy("stripe_subscription_id", sub.id)) ?? (await campaignBy("id", sub.metadata?.campaign_id));
    if (!c) return;
    if (sub.status === "active") {
      await setCampaign(c.id, { billing_status: "active" });
    } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
      // Ended on schedule after the last day, or stopped early (final retry failed, or cancelled):
      // a card that's still running is paused.
      const early = c.ends_on >= todayLA();
      await setCampaign(c.id, { billing_status: "canceled", ...(early && c.status === "live" ? { status: "paused" } : {}) });
    } else if (sub.status === "past_due") {
      await setCampaign(c.id, { billing_status: "past_due" });
    }
  }
}
