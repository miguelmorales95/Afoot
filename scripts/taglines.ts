// Write taglines for upcoming events that don't have one (new imports get one from extraction).
//   npm run taglines                    # every upcoming event without a tagline, soonest first
//   npm run taglines -- --limit 50      # just the next 50
//   npm run taglines -- --dry-run       # print, don't save
//   npm run taglines -- --anthropic     # Claude instead of the local model

import "./env";

import { supabase } from "../lib/supabase";
import { complete, defaultProvider, extractJson } from "../lib/llm";
import { cleanTagline } from "../lib/extract";
import { repeatsCard } from "../lib/format";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const provider = args.includes("--anthropic") ? "anthropic" : defaultProvider();
const limitAt = args.indexOf("--limit");
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) || Infinity : Infinity;
const BATCH = 8;

const SYSTEM = `You write a tagline for each event card on an LA events app's phone view.
A tagline is at most 9 words telling someone scrolling what this actually is or what they'll do,
e.g. "Six local artists, photography and mixed media" or "Teams compete, prizes for the top three".
The card already shows the title, venue, neighborhood, date, time, price and tags, so NEVER
repeat any of those. Use only facts from the description. No marketing words (amazing,
unforgettable, don't miss), no "join us". Use null when the description adds nothing beyond the card.
Reply with JSON only: {"taglines":[{"i":0,"tagline":"..." or null}]}`;

interface Row { id: string; title: string; description: string | null; category: string | null; tags: string[] | null; venue: { name: string } | null }

async function upcomingWithoutTagline(): Promise<Row[]> {
  const now = new Date().toISOString();
  const seen = new Map<string, Row>();
  for (let from = 0; seen.size < LIMIT; from += 1000) {
    const { data, error } = await supabase
      .from("event_occurrences")
      .select("starts_at, event:events!inner(id, title, description, category, tags, status, tagline, venue:venues(name))")
      .gte("starts_at", now)
      .eq("event.status", "active")
      .is("event.tagline", null)
      .order("starts_at")
      .range(from, from + 999);
    if (error) throw error;
    for (const o of (data ?? []) as unknown as { event: Row & { description: string | null } }[]) {
      if (o.event.description && !seen.has(o.event.id)) seen.set(o.event.id, o.event);
    }
    if (!data || data.length < 1000) break;
  }
  return [...seen.values()].slice(0, LIMIT);
}

async function main() {
  const rows = await upcomingWithoutTagline();
  console.log(`${rows.length} upcoming events need a tagline (${provider}).`);
  let saved = 0;
  for (let b = 0; b < rows.length; b += BATCH) {
    const chunk = rows.slice(b, b + BATCH);
    const prompt = chunk
      .map((e, i) => `${i}. Title: ${e.title}\n   Venue: ${e.venue?.name ?? ""}\n   Category: ${e.category ?? ""} · Tags: ${(e.tags ?? []).join(", ")}\n   Description: ${e.description}`)
      .join("\n\n");
    let out: { taglines?: { i: number; tagline: string | null }[] } = {};
    try {
      out = JSON.parse(extractJson(await complete({ system: SYSTEM, prompt, json: true, maxTokens: 1500, temperature: 0.2, provider })));
    } catch (e) {
      console.warn(`  batch ${b / BATCH + 1}: unusable reply (${(e as Error).message}); skipped`);
      continue;
    }
    for (const t of out.taglines ?? []) {
      const ev = chunk[t.i];
      const tagline = cleanTagline(t.tagline);
      if (!ev || !tagline) continue;
      if (repeatsCard(tagline, { title: ev.title, venue_name: ev.venue?.name })) {
        console.log(`  ${ev.title} → (rejected, repeats the title: "${tagline}")`);
        continue;
      }
      console.log(`  ${ev.title} → ${tagline}`);
      if (!dryRun) {
        const { error } = await supabase.from("events").update({ tagline }).eq("id", ev.id);
        if (error) console.warn(`  ! ${ev.title}: ${error.message}`);
        else saved++;
      }
    }
  }
  console.log(dryRun ? "Dry run: nothing saved." : `Saved ${saved} tagline(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
