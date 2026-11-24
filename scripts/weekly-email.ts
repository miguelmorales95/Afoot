// The weekly email: for each confirmed subscriber, the next 7 days of events matching the filters
// they signed up with (place + types), best first, at most one card per venue and 3 per day, with
// the note in content/weekly-note.md on top. Order follows traffic_score, so whatever small-spot
// boost the nightly rank uses (npm run rank:lab to compare) carries into the email too.
//   npm run weekly-email -- --dry-run            # write each email to .weekly-email/ (nothing sent)
//   npm run weekly-email -- --to you@example.com # send only to that subscriber (a test)
//   npm run weekly-email                         # send to everyone confirmed (meant for Thursday morning)
import "./env";
import fs from "node:fs";
import path from "node:path";
import { supabase } from "../lib/supabase";
import { sendEmail } from "../lib/email";
import { dayKey, formatShortDate, formatTime } from "../lib/format";
import { SITE_URL, WEEKLY_FROM, escapeHtml, filterLine, unsubscribeUrl } from "../lib/weeklyEmail";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyTo = args.includes("--to") ? args[args.indexOf("--to") + 1]?.toLowerCase() : null;
const PER_DAY = 3;
const MAX = 15;

interface Ev { occurrence_id: string; event_id: string; title: string; venue_id: string; venue_name: string; starts_at: string; category: string | null; price: string | null; url: string | null; traffic_score: number | null; cancelled: boolean; uncertain_fields: string[] | null }
interface Sub { id: string; email: string; place_label: string; lat: number; lng: number; radius_km: number; types: string[]; token: string }

const filterKey = (c: string | null) => (c === "trivia" ? "games" : c ?? "other");

function note(): string[] {
  const raw = fs.existsSync("content/weekly-note.md") ? fs.readFileSync("content/weekly-note.md", "utf8") : "";
  return raw.replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

async function pick(s: Sub): Promise<Ev[]> {
  const { data, error } = await supabase.rpc("nearby_events", { in_lat: s.lat, in_lng: s.lng, in_radius_km: s.radius_km, in_days_ahead: 7 }).range(0, 4999);
  if (error) throw new Error(error.message);
  const evs = (data as Ev[]).filter((e) => !e.cancelled && Date.parse(e.starts_at) > Date.now() && (!s.types.length || s.types.includes(filterKey(e.category))));
  evs.sort((a, b) => (b.traffic_score ?? 0) - (a.traffic_score ?? 0));
  const venues = new Set<string>(), perDay = new Map<string, number>(), events = new Set<string>(), out: Ev[] = [];
  for (const e of evs) {
    const d = dayKey(e.starts_at);
    if (venues.has(e.venue_id) || events.has(e.event_id) || (perDay.get(d) ?? 0) >= PER_DAY) continue;
    venues.add(e.venue_id); events.add(e.event_id); perDay.set(d, (perDay.get(d) ?? 0) + 1);
    out.push(e);
    if (out.length >= MAX) break;
  }
  return out.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

function render(s: Sub, evs: Ev[], paragraphs: string[]) {
  const what = filterLine(s.place_label, s.types);
  const byDay = new Map<string, Ev[]>();
  for (const e of evs) byDay.set(dayKey(e.starts_at), [...(byDay.get(dayKey(e.starts_at)) ?? []), e]);
  const time = (e: Ev) => (e.uncertain_fields?.includes("starts_at") ? "Time TBA" : formatTime(e.starts_at));
  const link = (e: Ev) => e.url || SITE_URL;

  const text = [
    ...paragraphs, "",
    `This week: ${what}`, "",
    ...[...byDay.values()].flatMap((list) => [
      formatShortDate(list[0].starts_at).toUpperCase(),
      ...list.map((e) => `  ${time(e)}  ${e.title} @ ${e.venue_name}${e.price ? ` (${e.price})` : ""}\n    ${link(e)}`), "",
    ]),
    `Everything else: ${SITE_URL}`,
    `Stop these emails: ${unsubscribeUrl(s.token)}`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
<p style="font-size:13px;color:#666;margin-top:24px">This week: ${escapeHtml(what)}</p>
${[...byDay.values()].map((list) => `<h2 style="font-size:15px;letter-spacing:.06em;text-transform:uppercase;margin:24px 0 8px">${escapeHtml(formatShortDate(list[0].starts_at))}</h2>
${list.map((e) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.4"><b>${escapeHtml(time(e))}</b> · <a href="${escapeHtml(link(e))}" style="color:#1a1a1a;font-weight:700">${escapeHtml(e.title)}</a><br><span style="color:#555">${escapeHtml(e.venue_name)}${e.price ? ` · ${escapeHtml(e.price)}` : ""}</span></p>`).join("\n")}`).join("\n")}
<p style="margin-top:28px"><a href="${SITE_URL}" style="color:#1a1a1a">Everything else on Light Pole →</a></p>
<p style="font-size:12px;color:#888;margin-top:24px">You signed up for ${escapeHtml(what)}. <a href="${unsubscribeUrl(s.token)}" style="color:#888">Stop these emails</a>.</p>
</div>`;
  return { subject: `Your week on the pole: ${what}`, text, html };
}

async function main() {
  let q = supabase.from("email_subscribers").select("id,email,place_label,lat,lng,radius_km,types,token").not("confirmed_at", "is", null).is("unsubscribed_at", null);
  if (onlyTo) q = q.eq("email", onlyTo);
  const { data: subs, error } = await q;
  if (error) throw new Error(error.message);
  const paragraphs = note();
  console.log(`${subs.length} subscriber(s)${dryRun ? " (dry run)" : ""}; note: ${paragraphs.length ? "yes" : "none"}.`);
  if (dryRun) fs.mkdirSync(".weekly-email", { recursive: true });
  for (const s of subs as Sub[]) {
    const evs = await pick(s);
    if (!evs.length) { console.log(`  ${s.email}: nothing this week, skipped`); continue; }
    const m = render(s, evs, paragraphs);
    if (dryRun) {
      const file = path.join(".weekly-email", `${s.email.replace(/[^a-z0-9]+/gi, "_")}.html`);
      fs.writeFileSync(file, m.html);
      console.log(`  ${s.email}: ${evs.length} events → ${file}`);
      continue;
    }
    try {
      await sendEmail({
        to: s.email, from: WEEKLY_FROM, subject: m.subject, html: m.html, text: m.text,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl(s.token)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      await supabase.from("email_subscribers").update({ last_sent_at: new Date().toISOString() }).eq("id", s.id);
      console.log(`  ${s.email}: sent ${evs.length} events`);
    } catch (e) {
      console.warn(`  ${s.email}: ${(e as Error).message}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
