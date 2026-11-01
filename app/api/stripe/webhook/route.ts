import { NextRequest, NextResponse } from "next/server";
import { handleStripeEvent, stripe } from "@/lib/sponsorBilling";

// Stripe's signed events for sponsor billing (lib/sponsorBilling.ts). In Stripe → Developers →
// Webhooks, point https://afoot.somedude.app/api/stripe/webhook at: checkout.session.completed,
// invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const st = stripe();
  if (!st || !secret) return NextResponse.json({ error: "Stripe isn't set up" }, { status: 503 });
  // The signature covers the exact bytes Stripe sent, so read the raw body.
  const raw = await req.text();
  let event;
  try {
    event = st.webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }
  try {
    const fresh = await handleStripeEvent(event);
    return NextResponse.json({ received: true, duplicate: !fresh });
  } catch (err) {
    console.error("stripe webhook error:", (err as Error).message);
    return NextResponse.json({ error: "Couldn't apply that event" }, { status: 500 }); // Stripe retries
  }
}
