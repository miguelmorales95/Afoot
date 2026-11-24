// The weekly email: for each confirmed subscriber, the next 7 days of events matching the filters
// they signed up with (place + types), best first, at most one card per venue and 3 per day, with
// the note in content/weekly-note.md on top. Order follows traffic_score, so whatever small-spot
// boost the nightly rank uses (npm run rank:lab to compare) carries into the email too.
//   npm run weekly-email -- --dry-run            # write each email to .weekly-email/ (nothing sent)
//   npm run weekly-email -- --to you@example.com # a test: that subscriber's email, or a sample
//                                                  (all of LA, every type) if they haven't signed up
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
const MAX = 15;
// Anyone sent to in the last 5 days is skipped, so a rerun (or both cron slots) can't double-send.
const RESEND_GAP = 5 * 864e5;

interface Ev { occurrence_id: string; event_id: string; title: string; venue_id: string; venue_name: string; starts_at: string; category: string | null; price: string | null; url: string | null; traffic_score: number | null; cancelled: boolean; uncertain_fields: string[] | null }
interface Sub { id: string; email: string; place_label: string; lat: number; lng: number; radius_km: number; types: string[]; token: string }

const filterKey = (c: string | null) => (c === "trivia" ? "games" : c ?? "other");

function note(): string[] {
  const raw = fs.existsSync("content/weekly-note.md") ? fs.readFileSync("content/weekly-note.md", "utf8") : "";
  return raw.replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

// Time of day in LA, in hours (19.5 = 7:30 PM).
const HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", hourCycle: "h23" });
const laHours = (iso: string) => { const p = Object.fromEntries(HM.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return Number(p.hour) + Number(p.minute) / 60; };
type Slot = "day" | "evening" | "late";
const slotOf = (h: number): Slot => (h < 17 ? "day" : h < 21 ? "evening" : "late");

// Per weekday (0 = Sun): how many picks, and a nudge per time of day, in traffic_score points.
// Weekends get a daytime pick on purpose; Sunday leans daytime and away from late nights (work
// tomorrow); weeknights stay evening, with late shows only when they're clearly the best.
const DAY_RULES: Record<number, { picks: number; nudge: Record<Slot, number> }> = {
  0: { picks: 3, nudge: { day: 18, evening: 0, late: -20 } },
  1: { picks: 2, nudge: { day: 0, evening: 0, late: -12 } },
  2: { picks: 2, nudge: { day: 0, evening: 0, late: -12 } },
  3: { picks: 2, nudge: { day: 0, evening: 0, late: -10 } },
  4: { picks: 2, nudge: { day: 0, evening: 0, late: -8 } },
  5: { picks: 3, nudge: { day: 4, evening: 0, late: 0 } },
  6: { picks: 3, nudge: { day: 12, evening: 0, late: 0 } },
};
// Spread within a day: each pick already in the same time of day costs this much, and one starting
// within 90 minutes of a pick costs this much more. A clearly better event still wins.
const SAME_SLOT = 14, CLOSE_START = 10;

async function pick(s: Sub): Promise<Ev[]> {
  const { data, error } = await supabase.rpc("nearby_events", { in_lat: s.lat, in_lng: s.lng, in_radius_km: s.radius_km, in_days_ahead: 7 }).range(0, 4999);
  if (error) throw new Error(error.message);
  const evs = (data as Ev[]).filter((e) => !e.cancelled && Date.parse(e.starts_at) > Date.now() && (!s.types.length || s.types.includes(filterKey(e.category))));
  const byDay = new Map<string, Ev[]>();
  for (const e of evs) byDay.set(dayKey(e.starts_at), [...(byDay.get(dayKey(e.starts_at)) ?? []), e]);
  const venues = new Set<string>(), events = new Set<string>(), out: Ev[] = [];
  for (const [d, list] of [...byDay].sort(([x], [y]) => x.localeCompare(y))) {
    const rule = DAY_RULES[new Date(d + "T12:00:00Z").getUTCDay()];
    const chosen: { e: Ev; h: number | null }[] = [];
    while (chosen.length < rule.picks) {
      let best: { e: Ev; h: number | null; v: number } | null = null;
      for (const e of list) {
        if (venues.has(e.venue_id) || events.has(e.event_id)) continue;
        const h = e.uncertain_fields?.includes("starts_at") ? null : laHours(e.starts_at);
        const slot = h === null ? "evening" : slotOf(h);
        let v = (e.traffic_score ?? 30) + rule.nudge[slot];
        v -= SAME_SLOT * chosen.filter((c) => (c.h === null ? "evening" : slotOf(c.h)) === slot).length;
        if (h !== null && chosen.some((c) => c.h !== null && Math.abs(c.h - h) < 1.5)) v -= CLOSE_START;
        if (!best || v > best.v) best = { e, h, v };
      }
      if (!best) break;
      chosen.push(best); venues.add(best.e.venue_id); events.add(best.e.event_id);
    }
    out.push(...chosen.map((c) => c.e));
  }
  // Over the cap: drop the lowest-scored, but never a day's only pick.
  while (out.length > MAX) {
    const counts = new Map<string, number>();
    for (const e of out) counts.set(dayKey(e.starts_at), (counts.get(dayKey(e.starts_at)) ?? 0) + 1);
    const drop = out.filter((e) => counts.get(dayKey(e.starts_at))! > 1).sort((x, y) => (x.traffic_score ?? 0) - (y.traffic_score ?? 0))[0];
    out.splice(out.indexOf(drop ?? out[out.length - 1]), 1);
  }
  return out.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
}

function render(s: Sub, evs: Ev[], paragraphs: string[]) {
  const what = filterLine(s.place_label, s.types);
  const byDay = new Map<string, Ev[]>();
  for (const e of evs) byDay.set(dayKey(e.starts_at), [...(byDay.get(dayKey(e.starts_at)) ?? []), e]);
  // Midnight on the dot is how date-only listings come in: say "All day", not "12:00 AM".
  const time = (e: Ev) => (e.uncertain_fields?.includes("starts_at") ? "Time TBA" : laHours(e.starts_at) === 0 ? "All day" : formatTime(e.starts_at));
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

  // Looks like the app: wood pole, bright posters with a black time block, Anton lettering where the
  // mail app loads web fonts (Apple Mail), bold condensed fallbacks elsewhere (Gmail). Tables and
  // inline styles only, since that's what email clients render reliably.
  const WOOD = "#2b2119", CREAM = "#f3ece2", INK = "#111111";
  const PAPER = ["#fff23a", "#ff5fae", "#86f45c", "#ff9a3c", "#62d8ff"];
  const POSTER = "Anton,Impact,'Arial Narrow Bold','Helvetica Neue Condensed Bold','Roboto Condensed',sans-serif-condensed,Arial,sans-serif";
  const BODY = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  let n = 0;
  const card = (e: Ev) => {
    const paper = PAPER[n++ % PAPER.length];
    const href = escapeHtml(link(e));
    return `<tr><td style="padding:0 0 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${paper};border-radius:3px"><tr>
<td width="76" valign="top" style="padding:14px 0 14px 14px"><div style="background:${INK};color:${paper};font-family:${POSTER};font-size:17px;line-height:1.1;text-align:center;padding:7px 2px;border-radius:2px;text-transform:uppercase">${escapeHtml(time(e)).replace(" ", "<br>")}</div></td>
<td valign="top" style="padding:12px 14px 14px 12px">
<a href="${href}" style="color:${INK};text-decoration:none;font-family:${POSTER};font-size:23px;line-height:1.08;font-weight:700;text-transform:uppercase;letter-spacing:.01em">${escapeHtml(e.title)}</a>
<div style="font-family:${BODY};font-size:14px;font-weight:800;color:${INK};margin-top:5px">${escapeHtml(e.venue_name)}${e.price ? ` <span style="font-weight:600;opacity:.75">· ${escapeHtml(e.price)}</span>` : ""}</div>
<div style="margin-top:8px"><a href="${href}" style="font-family:${BODY};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${INK}">Details →</a></div>
</td></tr></table></td></tr>`;
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${WOOD}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WOOD}"><tr><td align="center" style="padding:24px 12px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 2px 14px;font-family:${POSTER};font-size:38px;line-height:1;text-transform:uppercase"><span style="color:#fff23a">Light</span> <span style="color:#ff5fae">Pole</span></td></tr>
${paragraphs.length ? `<tr><td style="padding:0 0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#cdae7e;border-radius:3px"><tr><td style="padding:16px 18px;font-family:${BODY};font-size:16px;line-height:1.5;color:#2a2016">
${paragraphs.map((p) => `<p style="margin:0 0 10px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n")}
</td></tr></table></td></tr>` : ""}
<tr><td style="padding:0 2px 4px;font-family:${BODY};font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#b9ab9a">This week · ${escapeHtml(what)}</td></tr>
${[...byDay.values()].map((list, i) => `<tr><td style="padding:18px 2px 10px;font-family:${POSTER};font-size:28px;line-height:1;text-transform:uppercase;color:${PAPER[i % PAPER.length]}">${escapeHtml(formatShortDate(list[0].starts_at))}</td></tr>
${list.map(card).join("\n")}`).join("\n")}
<tr><td align="center" style="padding:18px 0 0"><a href="${SITE_URL}" style="display:inline-block;background:${CREAM};color:${INK};font-family:${POSTER};font-size:20px;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:999px">Everything else on the pole →</a></td></tr>
<tr><td align="center" style="padding:22px 8px 0;font-family:${BODY};font-size:12px;line-height:1.5;color:#b9ab9a">You signed up for ${escapeHtml(what)}.<br><a href="${unsubscribeUrl(s.token)}" style="color:#b9ab9a">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `Your week on the pole: ${what}`, text, html };
}

async function main() {
  let q = supabase.from("email_subscribers").select("id,email,place_label,lat,lng,radius_km,types,token,last_sent_at").not("confirmed_at", "is", null).is("unsubscribed_at", null);
  if (onlyTo) q = q.eq("email", onlyTo);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let subs = (data as Sub[]).filter((s) => onlyTo || !(s as Sub & { last_sent_at?: string }).last_sent_at || Date.now() - Date.parse((s as Sub & { last_sent_at: string }).last_sent_at) > RESEND_GAP);
  // A test to someone who hasn't signed up: show them the all-of-LA version (the stop link won't work).
  if (onlyTo && !subs.length) subs = [{ id: "", email: onlyTo, place_label: "All of LA", lat: 34.0522, lng: -118.2437, radius_km: 80, types: [], token: "sample" }];
  const paragraphs = note();
  console.log(`${subs.length} subscriber(s)${dryRun ? " (dry run)" : ""}; note: ${paragraphs.length ? "yes" : "none"}.`);
  if (dryRun) fs.mkdirSync(".weekly-email", { recursive: true });
  for (const s of subs) {
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
      if (s.id) await supabase.from("email_subscribers").update({ last_sent_at: new Date().toISOString() }).eq("id", s.id);
      console.log(`  ${s.email}: sent ${evs.length} events`);
    } catch (e) {
      console.warn(`  ${s.email}: ${(e as Error).message}`);
    }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
