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
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const logs: string[] = [];
  const results = await ingestAll({ log: (s) => logs.push(s) });
  const occurrences = results.reduce((n, r) => n + r.occurrences, 0);

  return NextResponse.json({ ok: true, venues: results.length, occurrences, results });
}
