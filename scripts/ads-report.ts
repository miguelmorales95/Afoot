// Monthly sponsor report: for each sponsor with views or clicks in a month, a short
// plain-language summary (views, clicks and click rate per week, the card text, and a
// promo-phrase suggestion) written to reports/ads/<month>/<sponsor>.html and .txt.
//   npm run ads:report -- --month 2026-10          write files only
//   npm run ads:report -- --month 2026-10 --send   also email each sponsor via Resend
// Sending needs RESEND_API_KEY and ADS_REPORT_FROM in .env.local and a contact email on
// the sponsor. Without --month, reports last month (Los Angeles time).

import "./env";

import fs from "node:fs";
import path from "node:path";
import { supabase } from "../lib/supabase";
import { todayLA } from "../lib/campaigns";

interface Sponsor { id: string; business_name: string; contact_name: string | null; contact_email: string | null }
interface Campaign {
  id: string; sponsor_id: string; product: string; area: string; title: string;
  badge: string | null; body: string | null; cta: string | null; href: string; starts_on: string; ends_on: string;
}
interface Day { campaign_id: string; day: string; views: number; clicks: number }
interface Week { label: string; views: number; clicks: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

function args() {
  const a = process.argv.slice(2);
  const i = a.indexOf("--month");
  let month = i >= 0 ? a[i + 1] : "";
  if (!month) {
    const [y, m] = todayLA().split("-").map(Number);
    month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`--month must look like 2026-10 (got "${month}")`);
  return { month, send: a.includes("--send") };
}

/** Monday-to-Sunday weeks, clipped to the month: "Oct 1–5", "Oct 6–12", … */
function weeksOf(month: string): { label: string; from: string; to: string }[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: { label: string; from: string; to: string }[] = [];
  let start = 1;
  for (let d = 1; d <= last; d++) {
    const sunday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
    if (sunday || d === last) {
      const iso = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
      out.push({ label: start === d ? `${SHORT[m - 1]} ${d}` : `${SHORT[m - 1]} ${start}–${d}`, from: iso(start), to: iso(d) });
      start = d + 1;
    }
  }
  return out;
}

const rate = (clicks: number, views: number) => (views ? `${((clicks / views) * 100).toFixed(1)}%` : "–");
const n = (x: number) => x.toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "sponsor";

function report(sponsor: Sponsor, campaigns: Campaign[], days: Day[], month: string) {
  const [y, m] = month.split("-").map(Number);
  const monthName = `${MONTHS[m - 1]} ${y}`;
  const weeks = weeksOf(month);
  const parts = campaigns
    .map((c) => {
      const mine = days.filter((d) => d.campaign_id === c.id);
      const rows: Week[] = weeks.map((w) => {
        const inWeek = mine.filter((d) => d.day >= w.from && d.day <= w.to);
        return { label: w.label, views: inWeek.reduce((a, d) => a + d.views, 0), clicks: inWeek.reduce((a, d) => a + d.clicks, 0) };
      });
      const views = rows.reduce((a, r) => a + r.views, 0);
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      return { c, rows, views, clicks };
    })
    .filter((p) => p.views || p.clicks);

  const greeting = sponsor.contact_name ? `Hi ${sponsor.contact_name.split(" ")[0]},` : "Hi,";
  const where = (c: Campaign) => (c.area === "all" ? "everywhere on Afoot" : `in ${c.area}`);
  const what = (c: Campaign) => (c.product === "featured_event" ? "featured event" : "sponsor card");
  const promo = "Want to see who came in because of Afoot? Add a promo phrase to your card, like “Say AFOOT for $1 off” (or any small perk), and keep a tally at the counter. Reply with the count and we'll put it in next month's report.";
  const privacy = "How we count: a view is your card being at least half on screen, counted once per page view; a click is a tap on it. Afoot doesn't use cookies or track visitors, so these are plain counts. Clicks arrive on your site tagged utm_source=afoot, so they also show up in your own analytics.";

  // --- plain text ---
  const text = [
    greeting,
    "",
    `Here's how your Afoot ${parts.length > 1 ? "placements" : what(parts[0].c)} did in ${monthName}.`,
    ...parts.flatMap(({ c, rows, views, clicks }) => [
      "",
      `${c.badge ? `${c.badge} ` : ""}${c.title} (${what(c)}, ${where(c)})`,
      `  ${c.body ?? ""}${c.cta ? ` [${c.cta}]` : ""}`.trimEnd(),
      `  ${n(views)} views, ${n(clicks)} clicks, ${rate(clicks, views)} click rate`,
      ...rows.map((r) => `  ${r.label.padEnd(12)} ${String(r.views).padStart(6)} views ${String(r.clicks).padStart(5)} clicks  ${rate(r.clicks, r.views)}`),
    ]),
    "",
    promo,
    "",
    privacy,
    "",
    "Thanks for supporting Afoot,",
    "Miguel",
  ].join("\n");

  // --- HTML (simple inline styles so it survives email clients) ---
  const td = 'style="padding:4px 12px 4px 0;text-align:right"';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Afoot report: ${esc(sponsor.business_name)}, ${monthName}</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:560px;margin:24px auto;padding:0 16px;line-height:1.5">
<p>${esc(greeting)}</p>
<p>Here's how your Afoot ${parts.length > 1 ? "placements" : what(parts[0].c)} did in <strong>${monthName}</strong>.</p>
${parts.map(({ c, rows, views, clicks }) => `
<div style="border:1px solid #e3e3e8;border-radius:14px;padding:14px;margin:18px 0 8px;max-width:300px">
  <div style="display:flex;justify-content:space-between;font-size:18px">${esc(c.badge || "✨")}<span style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#888">Sponsored</span></div>
  <div style="font-weight:600;font-size:14px">${esc(c.title)}</div>
  ${c.body ? `<div style="font-size:12px;color:#666">${esc(c.body)}</div>` : ""}
  ${c.cta ? `<div style="font-size:12px;color:#a21caf;margin-top:8px">${esc(c.cta)}</div>` : ""}
</div>
<p style="margin:4px 0;color:#555;font-size:13px">${what(c)[0].toUpperCase() + what(c).slice(1)}, shown ${esc(where(c))}.</p>
<p style="margin:8px 0"><strong>${n(views)}</strong> views · <strong>${n(clicks)}</strong> clicks · <strong>${rate(clicks, views)}</strong> click rate</p>
<table style="border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums">
  <tr style="color:#888"><td style="padding:4px 12px 4px 0">Week</td><td ${td}>Views</td><td ${td}>Clicks</td><td ${td}>Click rate</td></tr>
  ${rows.map((r) => `<tr><td style="padding:4px 12px 4px 0">${r.label}</td><td ${td}>${n(r.views)}</td><td ${td}>${n(r.clicks)}</td><td ${td}>${rate(r.clicks, r.views)}</td></tr>`).join("\n  ")}
</table>`).join("\n")}
<p style="margin-top:20px">${esc(promo)}</p>
<p style="font-size:12px;color:#777">${esc(privacy)}</p>
<p>Thanks for supporting Afoot,<br>Miguel</p>
</body></html>
`;
  return { subject: `Your Afoot numbers for ${monthName}`, text, html, active: parts.length > 0 };
}

async function sendEmail(to: string, subject: string, text: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ADS_REPORT_FROM, to: [to], subject, text, html }),
  });
  // Report the status only; the response never contains the key, but don't echo bodies.
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}

async function main() {
  const { month, send } = args();
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;

  const { data: days, error } = await supabase
    .from("campaign_daily").select("campaign_id, day, views, clicks").gte("day", first).lte("day", last);
  if (error) throw new Error(`Couldn't read campaign_daily (${error.message}). Has the sponsor migration been applied?`);
  const ids = [...new Set((days as Day[]).map((d) => d.campaign_id))];
  if (!ids.length) {
    console.log(`No sponsor views or clicks in ${month}; nothing to report.`);
    return;
  }
  const { data: campaigns } = await supabase
    .from("campaigns").select("id, sponsor_id, product, area, title, badge, body, cta, href, starts_on, ends_on").in("id", ids);
  const sponsorIds = [...new Set((campaigns as Campaign[]).map((c) => c.sponsor_id))];
  const { data: sponsors } = await supabase
    .from("sponsors").select("id, business_name, contact_name, contact_email").in("id", sponsorIds);

  const canSend = send && !!process.env.RESEND_API_KEY && !!process.env.ADS_REPORT_FROM;
  if (send && !canSend) console.log("--send needs RESEND_API_KEY and ADS_REPORT_FROM in .env.local; writing files only.");

  const dir = path.join("reports", "ads", month);
  fs.mkdirSync(dir, { recursive: true });
  for (const s of (sponsors as Sponsor[]).sort((a, b) => a.business_name.localeCompare(b.business_name))) {
    const r = report(s, (campaigns as Campaign[]).filter((c) => c.sponsor_id === s.id), days as Day[], month);
    if (!r.active) continue;
    const base = path.join(dir, slug(s.business_name));
    fs.writeFileSync(`${base}.html`, r.html);
    fs.writeFileSync(`${base}.txt`, r.text);
    let note = "";
    if (canSend) {
      if (!s.contact_email) note = " (not sent: no contact email)";
      else {
        try {
          await sendEmail(s.contact_email, r.subject, r.text, r.html);
          note = ` (emailed ${s.contact_email})`;
        } catch (e) {
          note = ` (send failed: ${(e as Error).message})`;
        }
      }
    }
    console.log(`${base}.html${note}`);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
