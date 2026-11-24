import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/weeklyEmail";

// GET /api/newsletter/confirm?t=<token>  (the link in the confirmation email)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  const { data } = t
    ? await supabase.from("email_subscribers").update({ confirmed_at: new Date().toISOString(), unsubscribed_at: null }).eq("token", t).select("id")
    : { data: null };
  return NextResponse.redirect(`${SITE_URL}/?newsletter=${data?.length ? "confirmed" : "expired"}`);
}
