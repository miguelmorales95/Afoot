import { NextRequest, NextResponse } from "next/server";
import { adminAuthed } from "@/lib/adminAuth";
import { approveEventLink, pendingEventLinks, rejectEventLink } from "@/lib/eventLinks";

// Event links waiting for review (pasted on /submit). Protected by ADMIN_TOKEN.
//   GET                                      -> { links }
//   POST { id, action: "approve", details }  -> publishes it (details are the admin's corrections)
//   POST { id, action: "reject" }
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ links: await pendingEventLinks() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id || !["approve", "reject"].includes(body.action)) return NextResponse.json({ error: "id and action required" }, { status: 400 });
  try {
    if (body.action === "reject") { await rejectEventLink(body.id); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ ok: true, ...(await approveEventLink(body.id, body.details ?? {})) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
