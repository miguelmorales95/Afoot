import { NextResponse, type NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { addPasted, parseCards, somedudeFor, type PastedEvent } from "@/lib/somedude";

// POST /api/somedude  (Authorization: Bearer <Supabase access token>)
//   { action: "me" }                          → { area } if this account is a somedude
//   { action: "parse", cards: [{text,url}] }  → { events } (≤ 40 cards; the page sends 20)
//   { action: "add", events }                 → { results } (≤ 12; the page sends 8)
//   { action: "done", kind, events, results } → logs the import (afoot.paste_imports)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const dude = await somedudeFor(req);
  if (!dude) return NextResponse.json({ error: "This page is only for Light Pole's somedudes." }, { status: 403 });
  const b = await req.json().catch(() => null);
  try {
    switch (b?.action) {
      case "me":
        return NextResponse.json({ area: dude.area });
      case "parse": {
        const cards = (Array.isArray(b.cards) ? b.cards : []).slice(0, 40)
          .map((c: { text?: unknown; url?: unknown }) => ({ text: String(c?.text ?? "").slice(0, 7000), url: typeof c?.url === "string" ? c.url.slice(0, 300) : null }))
          .filter((c: { text: string }) => c.text.trim());
        return NextResponse.json({ events: cards.length ? await parseCards(cards) : [] });
      }
      case "add": {
        const evs = (Array.isArray(b.events) ? b.events : []).slice(0, 12) as PastedEvent[];
        return NextResponse.json({ results: await addPasted(evs) });
      }
      case "done": {
        const events = (Array.isArray(b.events) ? b.events : []) as PastedEvent[];
        const results = (Array.isArray(b.results) ? b.results : []) as { ok: boolean }[];
        await supabase.from("paste_imports").insert({
          email: dude.email, kind: b.kind === "facebook" ? "facebook" : "page",
          found: events.length, added: results.filter((r) => r.ok).length,
          already: events.filter((e) => e.status === "already").length,
          skipped: events.filter((e) => e.status === "skipped").length,
          items: events.map((e) => ({ title: e.title, start: e.start, venue: e.venue || e.city, url: e.url, status: e.status, interested: e.interested, going: e.going })),
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
