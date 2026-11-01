// Places with a fixed schedule and no calendar to read (farmers markets, flea markets, food fairs):
// data/sources/recurring.csv lists each one's days and hours, and this lists their dates for the
// next 45 days (not Thanksgiving, Christmas or New Year's Day). Run nightly by the GitHub Actions job; safe to re-run.
//   npm run recurring                # every row
//   npm run recurring -- --dry-run   # print the dates, write nothing
// days: "Sun", "Tue;Sat" (weekly) or "2nd Sun", "1st Fri" (monthly). time: "08:00-13:00", Los Angeles time.
import "./env";

import fs from "node:fs";
import { parseCsv } from "../lib/localEvents";
import { venueFor } from "../lib/venueMatch";
import { storeExtractedEvents } from "../lib/ingest";
import type { EventCategory } from "../lib/types";

const FILE = "data/sources/recurring.csv";
const DAYS = 45;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const LONG = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th"];

/** The UTC instant of a Los Angeles wall-clock time on a calendar date. */
function laInstant(date: string, hhmm: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "longOffset" })
    .formatToParts(guess).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-08:00";
  return new Date(`${date}T${hhmm}:00${offset}`).toISOString();
}

/** Thanksgiving, Christmas and New Year's Day, when markets close. */
const closed = (d: Date) => {
  const md = d.toISOString().slice(5, 10);
  return md === "12-25" || md === "01-01" || (d.getUTCMonth() === 10 && d.getUTCDay() === 4 && Math.ceil(d.getUTCDate() / 7) === 4);
};

/** "13:30" → "1:30pm". */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Dates (YYYY-MM-DD, Los Angeles) in the next DAYS days that match a rule like "Sun" or "2nd Sun". */
function datesFor(rule: string): string[] {
  const m = rule.trim().toLowerCase().match(/^(?:(1st|2nd|3rd|4th|5th) )?(sun|mon|tue|wed|thu|fri|sat)/);
  if (!m) throw new Error(`can't read days "${rule}"`);
  const nth = m[1] ? ORDINAL.indexOf(m[1]) : 0, weekday = WEEKDAYS.indexOf(m[2]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const out: string[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCDay() !== weekday) continue;
    if (nth && Math.ceil(d.getUTCDate() / 7) !== nth) continue;
    if (closed(d)) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const describe = (rules: string[], time: string) =>
  `${rules.map((r) => { const [a, b] = r.trim().split(" "); return b ? `${a} ${LONG[WEEKDAYS.indexOf(b.toLowerCase())].replace(/s$/, "")} of the month` : LONG[WEEKDAYS.indexOf(a.toLowerCase())]; }).join(" and ")}, ${time.split("-").map(clock).join(" to ")}`;

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  let total = 0;
  for (const r of parseCsv(fs.readFileSync(FILE, "utf8")).filter((x) => x.name)) {
    const rules = r.days.split(";");
    const [start, end] = r.time.split("-");
    const dates = rules.flatMap(datesFor).sort();
    const when = describe(rules, r.time);
    if (dryRun) { console.log(`${r.name}: ${when} → ${dates.join(", ")}`); continue; }
    const venueId = await venueFor({ name: r.name, address: r.address, lat: null, lng: null, website: r.website || null, source: "feed" });
    total += await storeExtractedEvents({
      venueId, source: "feed", fallbackUrl: r.website || null,
      events: [{
        title: r.name, description: `${when}.`, category: (r.category || "market") as EventCategory, price: null, url: r.website || null,
        recurrence_description: when, is_recurring: true, tags: [],
        occurrences: dates.map((d) => ({ start: laInstant(d, start), end: end ? laInstant(d, end) : null })),
      }],
    });
  }
  if (!dryRun) console.log(`${total} date(s) listed for the places in ${FILE}.`);
  process.exit(0);
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
