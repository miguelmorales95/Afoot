import { NextRequest, NextResponse } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";
import { TYPE_KEYS, WEEKLY_FROM, confirmUrl, escapeHtml, filterLine, newToken } from "@/lib/weeklyEmail";

// POST /api/newsletter/subscribe  { email, place, lat, lng, all?, types[], company? }
// Saves the person's current filters and emails a confirmation link (double opt-in: nothing
// weekly goes out until it's clicked). Signing up again with the same address updates the filters.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!hasSupabase) return NextResponse.json({ error: "The weekly email needs the database." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  if (b?.company) return NextResponse.json({ ok: true }); // honeypot

  const email = String(b?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }
  const lat = Number(b?.lat), lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ error: "Pick a place first." }, { status: 400 });
  const place = String(b?.place ?? "").trim().slice(0, 80) || "LA";
  const types = Array.isArray(b?.types) ? b.types.filter((t: unknown) => TYPE_KEYS.includes(String(t))) : [];

  const { data: existing } = await supabase.from("email_subscribers").select("token, confirmed_at, unsubscribed_at").eq("email", email).maybeSingle();
  const token = existing?.token ?? newToken();
  const row = {
    email, place_label: place, lat, lng, radius_km: b?.all ? 80 : 25, types, token,
    unsubscribed_at: null, updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("email_subscribers").upsert(row, { onConflict: "email" });
  if (error) {
    console.error("subscribe error:", error.message);
    return NextResponse.json({ error: "Couldn't save that. Try again in a bit." }, { status: 500 });
  }

  // Already confirmed (and not unsubscribed): just the new filters, no second confirmation.
  if (existing?.confirmed_at && !existing.unsubscribed_at) return NextResponse.json({ ok: true, updated: true });

  const what = filterLine(place, types);
  try {
    await sendEmail({
      to: email,
      from: WEEKLY_FROM,
      subject: "Confirm your weekly Light Pole email",
      text: `Tap to start getting ${what}, once a week:\n${confirmUrl(token)}\n\nDidn't ask for this? Ignore it and nothing else comes.`,
      html: `<p>Tap to start getting <b>${escapeHtml(what)}</b>, once a week:</p><p><a href="${confirmUrl(token)}">Yes, send it</a></p><p style="color:#777">Didn't ask for this? Ignore it and nothing else comes.</p>`,
    });
  } catch (e) {
    console.error("confirm email failed:", (e as Error).message);
    return NextResponse.json({ error: "Saved, but the confirmation email didn't send. Try again later." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
