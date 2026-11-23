import { NextRequest, NextResponse } from "next/server";
import { adminAuthed } from "@/lib/adminAuth";
import {
  fillAddress, fillPrice, getSetting, queue, setSetting, skipVenue, suggestAddress, updateOutreach, venueStats,
} from "@/lib/founderQueue";

// The founder queue. Protected by ADMIN_TOKEN.
//   GET                       -> { cards, remaining, totals, waiting }
//   GET ?view=outreach        -> { venues }  (venues with upcoming dates, most dates first)
//   GET ?view=settings        -> { rankingPrompt, weeklyPlan }
//   GET ?suggest=<venueId>    -> { address }  (a map lookup of the venue's name)
//   POST { action: "address" | "price", venueId, value, dates }
//   POST { action: "skip", venueId }
//   POST { action: "outreach", venueId, status?, contacted?, notes? }
//   POST { action: "prompt", value }
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams;
  try {
    if (q.get("suggest")) return NextResponse.json({ address: await suggestAddress(q.get("suggest")!) });
    if (q.get("view") === "outreach") {
      const venues = (await venueStats()).sort((a, b) => b.dates - a.dates);
      return NextResponse.json({ venues });
    }
    if (q.get("view") === "settings") {
      const [rankingPrompt, weeklyPlan] = await Promise.all([getSetting("ranking_prompt"), getSetting("weekly_plan")]);
      return NextResponse.json({ rankingPrompt: rankingPrompt ?? "", weeklyPlan });
    }
    return NextResponse.json(await queue());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!adminAuthed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const value = typeof b.value === "string" ? b.value : "";
  const dates = Number.isFinite(b.dates) ? Number(b.dates) : 0;
  try {
    switch (b.action) {
      case "address": return NextResponse.json({ ok: true, ...(await fillAddress(b.venueId, value, dates)) });
      case "price": await fillPrice(b.venueId, value, dates); break;
      case "skip": await skipVenue(b.venueId); break;
      case "outreach":
        await updateOutreach(b.venueId, { status: b.status, contacted: Boolean(b.contacted), notes: typeof b.notes === "string" ? b.notes : undefined });
        break;
      case "prompt":
        if (!value.trim()) throw new Error("The prompt is empty");
        await setSetting("ranking_prompt", value.trim().slice(0, 4000));
        break;
      default: return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
