// AI clean-up: re-read the source page of every upcoming event that still has
// unconfirmed details (or an open "wrong info" / "cancelled" report) and ask the model
// whether the page confirms them.
//
// Trust rules — the model can only act by quoting the page:
//   - "confirmed" is applied automatically, but only if the quote really appears on the
//     page and contains the detail (the hour, the day, a price, the street number), and
//     no one has answered "no" to that detail.
//   - "different" and "cancelled" never change the listing; they become a flag in the
//     /admin queue with the quote, for a person to decide.
// Works with Claude (LLM_PROVIDER=anthropic, Haiku 5.5 ≈ $0.001 per event) or a free
// local Ollama model (LLM_PROVIDER=ollama).

import { supabase } from "./supabase";
import { complete, defaultProvider } from "./llm";
import { fetchPageText } from "./scrape";

const LA = "America/Los_Angeles";
const RECHECK_EVERY_HOURS = 6;
const LOOK_AHEAD_DAYS = 14;
const FIELDS = ["starts_at", "date", "address", "price"] as const;
type Field = (typeof FIELDS)[number];

interface Candidate {
  id: string;
  title: string;
  price: string | null;
  url: string | null;
  source_url: string | null;
  uncertain_fields: Field[];
  rechecked_at: string | null;
  venues: { name: string; address: string | null } | null;
  event_occurrences: { id: string; starts_at: string; cancelled: boolean }[];
}

interface Check { field: Field; verdict: "confirmed" | "different" | "not_found"; value?: string; quote?: string }
interface Reply { checks?: Check[]; cancelled?: { is_cancelled?: boolean; quote?: string } }

export interface RecheckResult { title: string; outcome: string }

const squash = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const localParts = (iso: string) => {
  const d = new Date(iso);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: LA, ...o }).format(d);
  return {
    date: fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    time: fmt({ hour: "numeric", minute: "2-digit" }),
    day: fmt({ day: "numeric" }),
    weekday: fmt({ weekday: "long" }),
    month: fmt({ month: "long" }),
    hour12: fmt({ hour: "numeric", hour12: true }).replace(/\s?[AP]M/i, ""),
  };
};

/** The quote must be on the page, and must actually contain the detail it claims. */
function quoteBacksUp(field: Field, quote: string | undefined, page: string, ev: Candidate, startsAt: string): boolean {
  if (!quote || quote.trim().length < 6) return false;
  const q = squash(quote);
  if (!squash(page).includes(q)) return false;
  const p = localParts(startsAt);
  if (field === "starts_at") return new RegExp(`\\b${p.hour12}(:\\d\\d)?\\s*(a\\.?m|p\\.?m|$|\\s)`, "i").test(q) || /noon|midnight/.test(q);
  if (field === "date") return new RegExp(`\\b${p.day}(st|nd|rd|th)?\\b`).test(q) || q.includes(p.weekday.toLowerCase()) || q.includes(p.month.toLowerCase().slice(0, 3));
  if (field === "price") return /\$|free|no cover|donation/.test(q);
  if (field === "address") {
    const num = ev.venues?.address?.match(/^\d+/)?.[0];
    return num ? q.includes(num) : q.includes(squash(ev.venues?.name || "").slice(0, 12));
  }
  return false;
}

/** The part of a long listing page that mentions this event (pages like weekly roundups list dozens). */
function relevantText(page: string, title: string): string {
  if (page.length <= 9000) return page;
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const lower = page.toLowerCase();
  let best = 0, bestScore = -1;
  for (let i = 0; i < lower.length; i += 500) {
    const window = lower.slice(i, i + 4000);
    const score = words.filter((w) => window.includes(w)).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return page.slice(Math.max(0, best - 2000), best + 6000);
}

const SYSTEM = `You verify local event listings against the event's own web page.
Reply with JSON only: one entry in "checks" for EACH detail you are asked to check.
Example for a request to check starts_at and price:
{"checks":[
  {"field":"starts_at","verdict":"confirmed","value":"","quote":"Saturday, Oct 24 · 8 PM"},
  {"field":"price","verdict":"different","value":"$15","quote":"Tickets $15 at the door"}
 ],
 "cancelled":{"is_cancelled":false,"quote":""}}
Each "field" is exactly one of: starts_at, date, address, price. Each "verdict" is exactly one of: confirmed, different, not_found.
Rules:
- Only use the page text provided. Copy quotes character for character from the page; never paraphrase.
- "confirmed" only if the page states this detail for this event on this date.
- "different" only if the page clearly gives another value for this event; put that value in "value".
- If the page doesn't mention this event or detail, use "not_found" with an empty quote.
- is_cancelled is true only if the page says this event or date is cancelled or postponed.`;

async function askModel(ev: Candidate, startsAt: string, fields: Field[], notes: string[], page: string): Promise<Reply> {
  const p = localParts(startsAt);
  const listing = [
    `Title: ${ev.title}`,
    `Venue: ${ev.venues?.name ?? "?"}${ev.venues?.address ? `, ${ev.venues.address}` : ""}`,
    `Date: ${p.date}`,
    `Start time: ${p.time}`,
    `Price: ${ev.price ?? "unknown"}`,
  ].join("\n");
  const prompt = `Our listing:\n${listing}\n\nDetails to check: ${fields.join(", ")}` +
    (notes.length ? `\nWhat people reported: ${notes.map((n) => `"${n}"`).join("; ")}` : "") +
    `\n\nPage text (${ev.source_url}):\n"""\n${page}\n"""`;
  const raw = await complete({ system: SYSTEM, prompt, json: true, maxTokens: 800, temperature: 0 });
  const json = raw.replace(/```json|```/g, "");
  let reply: Reply;
  try { reply = JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1)); } catch { return {}; }
  // Small models sometimes merge fields ("starts_at|date", "confirmed|confirmed"); split them.
  reply.checks = (reply.checks || []).flatMap((c) => {
    const fs = String(c.field || "").split("|").map((f) => f.trim());
    const vs = String(c.verdict || "").split("|").map((v) => v.trim());
    return fs.map((field, i) => ({ ...c, field: field as Field, verdict: (vs[i] ?? vs[0]) as Check["verdict"] }));
  });
  return reply;
}

async function flag(eventId: string, occurrenceId: string | null, reason: "wrong_info" | "cancelled", note: string) {
  // One AI flag per event and reason (the unique index makes repeats a no-op).
  await supabase.from("event_flags").insert({ event_id: eventId, occurrence_id: occurrenceId, kind: "report", reason, note: note.slice(0, 500), device_hash: "ai-recheck" });
}

export async function recheckEvents(opts: { limit?: number; dryRun?: boolean; log?: (s: string) => void } = {}): Promise<RecheckResult[]> {
  const log = opts.log ?? console.log;
  const now = Date.now();
  const { data, error } = await supabase
    .from("events")
    .select("id, title, price, url, source_url, uncertain_fields, rechecked_at, venues(name, address), event_occurrences(id, starts_at, cancelled)")
    .eq("status", "active");
  if (error) throw error;

  const { data: openFlags } = await supabase.from("event_flags").select("event_id, reason, note")
    .eq("status", "open").eq("kind", "report").in("reason", ["wrong_info", "cancelled"]).neq("device_hash", "ai-recheck");
  const { data: noAnswers } = await supabase.from("event_checks").select("event_id, field").eq("answer", "no");
  const disputed = new Set((noAnswers || []).map((a) => `${a.event_id}:${a.field}`));
  const notesFor = (id: string) => (openFlags || []).filter((f) => f.event_id === id).map((f) => f.note || f.reason);

  const due = (data as unknown as Candidate[])
    .map((ev) => ({ ev, next: ev.event_occurrences.filter((o) => !o.cancelled && Date.parse(o.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] }))
    .filter(({ ev, next }) => next && Date.parse(next.starts_at) < now + LOOK_AHEAD_DAYS * 86_400_000)
    .filter(({ ev }) => (ev.uncertain_fields?.length || notesFor(ev.id).length) && (ev.source_url || ev.url))
    .filter(({ ev }) => !ev.rechecked_at || now - Date.parse(ev.rechecked_at) > RECHECK_EVERY_HOURS * 3_600_000)
    .sort((a, b) => a.next!.starts_at.localeCompare(b.next!.starts_at)) // soonest first
    .slice(0, opts.limit ?? 40);

  log(`AI clean-up (${defaultProvider()}): ${due.length} event(s) to re-check${opts.dryRun ? " — dry run" : ""}`);
  const results: RecheckResult[] = [];

  for (const { ev, next } of due) {
    const source = ev.source_url || ev.url!;
    const fetched = await fetchPageText(source, 60000);
    const fields = (ev.uncertain_fields || []).filter((f) => FIELDS.includes(f));
    const notes = notesFor(ev.id);
    let outcome: string;

    if (!fetched.ok || fetched.text.length < 200) {
      outcome = `source unreadable (HTTP ${fetched.status})`;
    } else {
      const page = relevantText(fetched.text, ev.title);
      const reply = await askModel(ev, next!.starts_at, fields.length ? fields : ["date"], notes, page);
      if (process.env.RECHECK_DEBUG) log(`    model reply: ${JSON.stringify(reply)}`);
      const confirmed: Field[] = [];
      const parts: string[] = [];
      for (const c of reply.checks || []) {
        if (!FIELDS.includes(c.field)) continue;
        const backed = quoteBacksUp(c.field, c.quote, fetched.text, ev, next!.starts_at);
        if (c.verdict === "confirmed" && backed && fields.includes(c.field) && !disputed.has(`${ev.id}:${c.field}`)) {
          confirmed.push(c.field);
          parts.push(`confirmed ${c.field}: "${c.quote}"`);
        } else if (c.verdict === "different" && c.quote && squash(fetched.text).includes(squash(c.quote))) {
          parts.push(`page differs on ${c.field}: ${c.value ?? ""}`);
          if (!opts.dryRun) await flag(ev.id, next!.id, "wrong_info", `AI re-check: the source page says ${c.field.replace("_", " ")} is "${c.value ?? "?"}" — quote: "${c.quote}"`);
        } else if (c.verdict === "confirmed" && !backed) {
          parts.push(`unbacked claim on ${c.field} ignored`);
        }
      }
      const cq = reply.cancelled?.quote;
      if (reply.cancelled?.is_cancelled && cq && /cancel|postpone/i.test(cq) && squash(fetched.text).includes(squash(cq))) {
        parts.push("page says cancelled");
        if (!opts.dryRun) await flag(ev.id, next!.id, "cancelled", `AI re-check: the source page says "${cq}"`);
      }
      outcome = parts.join("; ") || "nothing confirmed on the page";

      if (!opts.dryRun && confirmed.length) {
        const remaining = fields.filter((f) => !confirmed.includes(f));
        await supabase.from("events").update({
          uncertain_fields: remaining,
          ...(remaining.length === 0 && { confidence: "high", verified_by: "ai", verified_at: new Date().toISOString() }),
        }).eq("id", ev.id);
      }
    }
    if (!opts.dryRun) {
      await supabase.from("events").update({ rechecked_at: new Date().toISOString(), recheck_note: outcome.slice(0, 1000) }).eq("id", ev.id);
    }
    log(`  · ${ev.title.slice(0, 60)} — ${outcome}`);
    results.push({ title: ev.title, outcome });
  }
  return results;
}
