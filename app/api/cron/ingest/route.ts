import { NextRequest, NextResponse } from "next/server";
import { ingestAll } from "@/lib/ingest";

// Scheduled ingestion. Wired to Vercel Cron via vercel.json.
// Protected by CRON_SECRET so randoms can't trigger paid LLM runs.
//
// Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically for crons.
// You can also trigger manually: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/ingest

export const dynamic = "force-dynamic";
export const maxDuration = 300; // seconds; raise your Vercel plan's limit as venue count grows

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  // No secret set means no scheduled runs: an open route would let anyone start paid AI work.
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  // Stop starting new venues after 4 minutes so the run ends inside maxDuration; the rest go
  // first next time.
  const results = await ingestAll({ log: (s) => logs.push(s), budgetMs: 240_000 });
  const occurrences = results.reduce((n, r) => n + r.occurrences, 0);

  return NextResponse.json({ ok: true, venues: results.length, occurrences, results });
}
