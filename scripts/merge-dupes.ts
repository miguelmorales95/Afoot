/**
 * Merge events that are the same show stored more than once: same venue, same source, a date
 * within an hour of each other, and similar titles (lib/dedupe.ts). Keeps the oldest event (its
 * title and id), moves over dates only the copies have, and deletes the copies. Dates someone
 * RSVP'd to or chatted on are never deleted: such a group is skipped and reported.
 *
 * Usage: npm run merge-dupes [--dry-run] [--verbose]
 */

import "./env";

import { supabase } from "../lib/supabase";
import { similarTitles, SAME_TIME_MS } from "../lib/dedupe";

const dryRun = process.argv.includes("--dry-run");
const verbose = process.argv.includes("--verbose");

interface Occ { id: string; event_id: string; starts_at: string }
interface Ev { id: string; title: string; venue_id: string; source: string; created_at: string; occ: Occ[] }

async function all<T>(build: (from: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function main(pass = 1): Promise<void> {
  console.log(`Finding events stored more than once${dryRun ? " (dry run)" : ""}…`);
  // Every page of results: the database returns at most 1,000 rows per request.
  const events = await all<Omit<Ev, "occ">>((f) =>
    supabase.from("events").select("id, title, venue_id, source, created_at").eq("status", "active").order("id").range(f, f + 999),
  );
  const occs = await all<Occ>((f) =>
    supabase.from("event_occurrences").select("id, event_id, starts_at").gte("starts_at", new Date(Date.now() - 86400000).toISOString()).order("id").range(f, f + 999),
  );
  const byId = new Map<string, Ev>(events.map((e) => [e.id, { ...e, occ: [] }]));
  for (const o of occs) byId.get(o.event_id)?.occ.push(o);
  console.log(`${events.length} active events, ${occs.length} upcoming dates.`);

  // Group per venue + source. An event joins a group only if it matches EVERY member (time and
  // title): with single links, a generic title ("Jazz Sunday", "Unsung 80s Soundtracks") chained
  // different shows together.
  const near = (a: Ev, b: Ev) =>
    a.occ.some((x) => b.occ.some((y) => Math.abs(Date.parse(x.starts_at) - Date.parse(y.starts_at)) <= SAME_TIME_MS));
  const blocks = new Map<string, Ev[]>();
  for (const e of byId.values()) if (e.occ.length) (blocks.get(`${e.venue_id}|${e.source}`) ?? blocks.set(`${e.venue_id}|${e.source}`, []).get(`${e.venue_id}|${e.source}`)!).push(e);
  const allGroups: Ev[][] = [];
  for (const list of blocks.values()) {
    const groups: Ev[][] = [];
    for (const e of list.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      const home = groups.find((g) => g.every((m) => near(m, e) && similarTitles(m.title, e.title)));
      if (home) home.push(e);
      else groups.push([e]);
    }
    allGroups.push(...groups);
  }
  const dupGroups = allGroups.filter((g) => g.length > 1);

  let merged = 0, deletedEvents = 0, deletedDates = 0, movedDates = 0, skipped = 0;
  for (const g of dupGroups) {
    g.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const [keep, ...copies] = g;
    const keepTimes = () => keep.occ.map((o) => Date.parse(o.starts_at));
    const toDelete: string[] = [], toMove: Occ[] = [];
    for (const c of copies)
      for (const o of c.occ) {
        const t = Date.parse(o.starts_at);
        if (keepTimes().some((k) => Math.abs(k - t) <= SAME_TIME_MS) || toMove.some((m) => Math.abs(Date.parse(m.starts_at) - t) <= SAME_TIME_MS)) toDelete.push(o.id);
        else toMove.push(o);
      }
    if (toDelete.length) {
      const [going, chat] = await Promise.all([
        supabase.from("rsvps").select("occurrence_id").in("occurrence_id", toDelete),
        supabase.from("messages").select("occurrence_id").in("occurrence_id", toDelete),
      ]);
      if (going.error || chat.error || (going.data?.length ?? 0) + (chat.data?.length ?? 0) > 0) {
        skipped++;
        console.log(`  skip "${keep.title}": a duplicate date has RSVPs or chat`);
        continue;
      }
    }
    merged++;
    console.log(`  ${keep.title}  ←  ${copies.map((c) => `"${c.title}"`).join(", ")}`);
    if (verbose) console.log(`     delete ${toDelete.length} date(s), move ${toMove.length}`);
    if (dryRun) continue;
    if (toDelete.length) await supabase.from("event_occurrences").delete().in("id", toDelete);
    for (const o of toMove) await supabase.from("event_occurrences").update({ event_id: keep.id }).eq("id", o.id);
    // Copies' past dates (and any left) go with them; the kept event has the show.
    await supabase.from("events").delete().in("id", copies.map((c) => c.id));
    deletedEvents += copies.length;
    deletedDates += toDelete.length;
    movedDates += toMove.length;
  }

  console.log(
    `\nPass ${pass}: ${dupGroups.length} group(s) of duplicates; merged ${merged}, skipped ${skipped}.` +
      (dryRun ? " Dry run: nothing changed." : ` Deleted ${deletedEvents} copy event(s) and ${deletedDates} duplicate date(s); moved ${movedDates} date(s).`),
  );
  // A copy that matches the kept event but not the other copies joins on the next pass.
  if (!dryRun && merged > 0 && pass < 6) return main(pass + 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
