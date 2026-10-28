// SC_2_Afoot: events from screenshots. Put screenshots of event pages (for example Facebook events
// you scrolled past, with the link visible) in SC_2_Afoot/screenshots/, then run
//   npm run screenshots                # read them; events wait in /admin → Event links
//   npm run screenshots -- --publish   # publish straight away (skip the review)
//   npm run screenshots -- --dry-run   # only print what it read; nothing saved or moved
// A local vision model (Ollama, OLLAMA_VISION_MODEL, default gemma3:4b) reads each picture: free and
// private; about 10–30 seconds a picture without a graphics card. Afterwards each screenshot moves
// to processed/ (or needs-review/ when no date could be read), with what the model saw beside it.
import "../scripts/env";
import fs from "node:fs";
import path from "node:path";
import { supabase } from "../lib/supabase";
import { approveEventLink } from "../lib/eventLinks";
import { laLocalToIso, linkSource, type LinkDetails } from "../lib/eventLink";
import type { EventCategory } from "../lib/types";

const DIR = path.join(process.cwd(), "SC_2_Afoot");
const IN = path.join(DIR, "screenshots");
const DONE = path.join(DIR, "processed");
const REVIEW = path.join(DIR, "needs-review");
const OLLAMA = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_VISION_MODEL || "gemma3:4b";
const args = process.argv.slice(2);
const PUBLISH = args.includes("--publish"), DRY = args.includes("--dry-run");
const CATS: EventCategory[] = ["music", "karaoke", "trivia", "games", "comedy", "market", "food", "class", "other"];

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());

const PROMPT = `This is a screenshot of an event listing (often a Facebook event) in Los Angeles. Today is ${today}.
Read it carefully and reply with JSON only:
{"events":[{"title": string, "date": "YYYY-MM-DD", "start_time": "HH:MM" (24-hour) or null, "end_time": "HH:MM" or null,
 "venue_name": string or null, "address": string or null, "price": string or null ("Free", "$10"),
 "description": short string or null, "link": the event's web address exactly as shown (for example
 https://www.facebook.com/events/1234567890) or null, "category": one of ${CATS.join(", ")}}]}
- Only events actually shown. Several events in one picture: list each.
- Dates without a year are the next time that date comes after today.
- Copy the link character by character from the address bar or the page; don't make one up.`;

/** Shrinks a screenshot to at most 1280 px on its long side (much faster for the model). */
async function shrink(file: string): Promise<string> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const data = fs.readFileSync(file).toString("base64");
    const ext = path.extname(file).slice(1).toLowerCase().replace("jpg", "jpeg");
    return await page.evaluate(async ({ data, ext }) => {
      const img = new Image();
      img.src = `data:image/${ext};base64,${data}`;
      await img.decode();
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    }, { data, ext });
  } finally {
    await browser.close();
  }
}

/** Asks the local vision model, streaming so a slow answer isn't cut off by a request timeout. */
async function ask(image: string): Promise<string> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, stream: true, format: "json", options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content: PROMPT, images: [image] }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${await res.text().catch(() => "")} (is "${MODEL}" pulled? ollama pull ${MODEL})`);
  let out = "", buf = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (line) out += JSON.parse(line).message?.content ?? "";
    }
  }
  return out;
}

const clean = (s: unknown, n = 300) => (typeof s === "string" && s.trim() ? s.trim().slice(0, n) : null);

/** A link the model read: only real web addresses, with https added when the address bar hid it. */
function cleanLink(raw: unknown): string | null {
  const s = clean(raw, 500)?.replace(/\s+/g, "");
  if (!s) return null;
  const url = /^https?:\/\//i.test(s) ? s : /^(www\.|m\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(s) ? `https://${s}` : null;
  try { return url ? new URL(url).toString() : null; } catch { return null; }
}

/** The model's date and time as an ISO time in LA. A missing or old year is fixed: a date more than two
 *  months behind today is next year's (screenshots are of upcoming events). */
function startOf(date: unknown, time: unknown): string | null {
  const d = clean(date, 10);
  const t = typeof time === "string" && /^\d{1,2}:\d{2}$/.test(time.trim()) ? time.trim().padStart(5, "0") : "19:00";
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const thisYear = Number(today.slice(0, 4));
  let y = Math.max(Number(d.slice(0, 4)), thisYear);
  const md = d.slice(4);
  if (Date.parse(`${y}${md}`) < Date.parse(today) - 60 * 86400_000) y += 1;
  return laLocalToIso(`${y}${md}T${t}`);
}

async function alreadyHave(link: string | null, title: string, starts: string) {
  if (link) {
    const { data } = await supabase.from("event_links").select("id").eq("url", link).limit(1);
    if (data?.length) return true;
  }
  const { data } = await supabase.from("event_links").select("id").eq("extracted->>title", title).eq("extracted->>starts_at", starts).limit(1);
  return !!data?.length;
}

async function main() {
  for (const d of [IN, DONE, REVIEW]) fs.mkdirSync(d, { recursive: true });
  const files = fs.readdirSync(IN).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => fs.statSync(path.join(IN, a)).mtimeMs - fs.statSync(path.join(IN, b)).mtimeMs);
  if (!files.length) return console.log(`No screenshots in ${IN}. Add some (png, jpg or webp) and run again.`);
  console.log(`${files.length} screenshot(s), reading with ${MODEL}${DRY ? " (dry run)" : PUBLISH ? " (publishing)" : " (to the review queue)"}…\n`);

  let added = 0;
  for (const [i, file] of files.entries()) {
    const full = path.join(IN, file);
    const started = Date.now();
    console.log(`[${i + 1}/${files.length}] ${file}`);
    let raw = "", events: any[] = [];
    try {
      raw = await ask(await shrink(full));
      events = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).events ?? []).filter((e: any) => clean(e?.title));
    } catch (e) {
      console.log(`  ! couldn't read it: ${(e as Error).message}`);
    }
    let usable = 0;
    for (const e of events) {
      const starts = startOf(e.date, e.start_time);
      const link = cleanLink(e.link);
      const details: LinkDetails = {
        title: clean(e.title, 200)!, description: clean(e.description, 1200), starts_at: starts ?? undefined,
        ends_at: e.end_time && e.date ? startOf(e.date, e.end_time) : null, url: link ?? undefined,
        price: clean(e.price, 60), category: CATS.includes(e.category) ? e.category : "other",
        venue_name: clean(e.venue_name, 200), address: clean(e.address), lat: null, lng: null,
      };
      console.log(`  • ${details.title} | ${starts ?? "no date"} | ${details.venue_name ?? "?"} | ${link ?? "no link"}`);
      if (!starts) continue;
      if (Date.parse(starts) < Date.now() - 6 * 3600_000) { console.log("    already happened: skipped"); continue; }
      usable++;
      if (DRY) continue;
      if (await alreadyHave(link, details.title!, starts)) { console.log("    already in the queue: skipped"); continue; }
      const { data: row, error } = await supabase.from("event_links").insert({
        url: link ?? `screenshot:${file}`, source: link ? linkSource(link) : "screenshot", extracted: details,
        read_error: link ? null : "No link could be read from the screenshot", note: `From screenshot ${file}`,
      }).select("id").single();
      if (error || !row) { console.log(`    ! not saved: ${error?.message}`); continue; }
      if (PUBLISH) {
        try { await approveEventLink(row.id, details); console.log("    published"); }
        catch (err) { console.log(`    ! saved for review instead: ${(err as Error).message}`); }
      }
      added++;
    }
    console.log(`  (${Math.round((Date.now() - started) / 1000)} s)`);
    if (!DRY) {
      const dest = usable ? DONE : REVIEW;
      fs.renameSync(full, path.join(dest, file));
      fs.writeFileSync(path.join(dest, `${file}.json`), raw || "{}");
    }
  }
  console.log(`\nDone. ${added} event(s) ${PUBLISH ? "published" : "waiting in /admin → Event links"}.`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
