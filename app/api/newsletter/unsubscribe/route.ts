import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { SITE_URL } from "@/lib/weeklyEmail";

// GET  /api/newsletter/unsubscribe?t=<token>  the link in every weekly email
// POST /api/newsletter/unsubscribe?t=<token>  one-click unsubscribe from mail apps (RFC 8058)
export const dynamic = "force-dynamic";

async function stop(t: string) {
  if (!t) return false;
  const { data } = await supabase.from("email_subscribers").update({ unsubscribed_at: new Date().toISOString() }).eq("token", t).select("id");
  return !!data?.length;
}

export async function GET(req: NextRequest) {
  await stop(req.nextUrl.searchParams.get("t") ?? "");
  return NextResponse.redirect(`${SITE_URL}/?newsletter=stopped`);
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ ok: await stop(req.nextUrl.searchParams.get("t") ?? "") });
}
