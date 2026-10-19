import { NextRequest, NextResponse } from "next/server";
import { getReviewGroups, applyAction } from "@/lib/admin";
import { demoReviewGroups, isDemoMode } from "@/lib/demo";
import type { ReviewGroup } from "@/lib/types";

// Admin review queue. Protected by ADMIN_TOKEN (header x-admin-token or
// ?token=). If ADMIN_TOKEN is unset, access is open (fine for local/demo).
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true; // not configured -> open (local/demo)
  const provided = req.headers.get("x-admin-token") || req.nextUrl.searchParams.get("token");
  return provided === token;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (isDemoMode()) {
    return NextResponse.json({ groups: demoReviewGroups(), demo: true });
  }
  try {
    const groups = await getReviewGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    console.error("admin review error:", (err as Error).message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { action?: "approve" | "reject"; group?: ReviewGroup };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!body.action || !body.group) {
    return NextResponse.json({ error: "action and group required" }, { status: 400 });
  }

  if (isDemoMode()) {
    return NextResponse.json({ ok: true, demo: true, note: "demo mode — nothing saved" });
  }
  try {
    const result = await applyAction({ action: body.action, group: body.group });
    return NextResponse.json(result);
  } catch (err) {
    console.error("admin action error:", (err as Error).message);
    return NextResponse.json({ ok: false, error: "action failed" }, { status: 500 });
  }
}
