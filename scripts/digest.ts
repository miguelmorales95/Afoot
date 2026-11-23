// The founder emails. Run each morning by .github/workflows/founder-digest.yml:
//   Monday: the week's plan. Thursday: check-in and the most important things left.
//   Saturday: ideas and the bigger, less technical problems, plus where to go pitch.
//   Other days: an email only when a high-traffic event in the next week is missing details.
//   npm run digest                 -> picks by the day in Los Angeles; at most one email per kind per day
//   npm run digest -- monday --dry -> print without sending or saving
// Needs RESEND_API_KEY, FOUNDER_EMAIL, ANTHROPIC_API_KEY and the Supabase variables.
import "./env";
import { supabase } from "../lib/supabase";
import { complete, extractJson } from "../lib/llm";
import { sendEmail } from "../lib/email";
import { actionsSince, getSetting, rankCards, setSetting, venueStats, type VenueStat } from "../lib/founderQueue";

type Kind = "monday" | "thursday" | "saturday" | "alert";
const DAY = 864e5;
const SITE = process.env.SITE_URL || "https://afoot.somedude.app";
const QUEUE = `${SITE}/admin/queue`;
const DIGEST_MODEL = process.env.DIGEST_MODEL || "claude-sonnet-5-5";
const ALERT_MODEL = process.env.ALERT_MODEL || "claude-haiku-5-5";

const CONTEXT = `Afoot (afoot.somedude.app) lists small, hard-to-find LA events. The founder, Miguel, runs it alone with about 18 hours a week
outside a day job, across several apps. Kinmap's paid launch (week of March 29, 2027) comes first; Afoot's audience push is April–May 2027,
and Afoot earns money from local venue sponsorships (no sponsors pay yet). Miguel has ADHD: he decides fast when given a little context,
prefers being told what to do over choosing, and would rather make a decision than avoid one. He is willing to pitch in person.
Keep every ask small and concrete: the whole to-do list in an email should fit in about an hour.`;

function laParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { weekday: p.weekday as string, hour: Number(p.hour), day: `${p.year}-${p.month}-${p.day}` };
}
const laDate = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface ResearchItem { eventId: string; title: string; venue: string; startsAt: string; link: string | null; missing: string[]; category: string | null }

/** Events in the next `days` days missing an address or price, not asked about before. */
async function researchCandidates(days: number): Promise<ResearchItem[]> {
  const { data, error } = await supabase.from("event_occurrences")
    .select("starts_at, event:events(id,title,url,source_url,price,category,status,venue:venues(name,address,lat))")
    .gte("starts_at", new Date().toISOString()).lte("starts_at", new Date(Date.now() + days * DAY).toISOString())
    .eq("cancelled", false).order("starts_at").limit(3000);
  if (error) throw new Error(error.message);
  const { data: asked } = await supabase.from("founder_alerts").select("event_id");
  const seen = new Set((asked ?? []).map((a) => a.event_id as string));
  const out: ResearchItem[] = [];
  for (const o of data as unknown as { starts_at: string; event: Record<string, any> | null }[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
    const e = o.event;
    if (!e || e.status !== "active" || seen.has(e.id)) continue;
    const missing = [!e.venue?.address && "address", !e.price?.trim() && "cost", e.venue?.lat == null && e.venue?.address && "map pin"].filter(Boolean) as string[];
    if (!missing.length) continue;
    seen.add(e.id);
    out.push({ eventId: e.id, title: e.title, venue: e.venue?.name ?? "?", startsAt: o.starts_at, link: e.url || e.source_url, missing, category: e.category });
  }
  return out;
}

/** Venues that haven't said yes (paying) or no, most dates first, for in-person pitching. */
function outreachCandidates(stats: VenueStat[]) {
  return stats.filter((v) => !["paying", "declined"].includes(v.outreach_status) && v.address)
    .sort((a, b) => b.dates - a.dates).slice(0, 30)
    .map((v) => ({ id: v.id, name: v.name, area: v.area ?? v.city ?? "LA", address: v.address, dates: v.dates, status: v.outreach_status, contacted: v.outreach_count, lastContacted: v.outreach_last_at?.slice(0, 10) ?? null }));
}

async function recentEmails(kind: Kind) {
  const { data } = await supabase.from("founder_emails").select("kind,la_day,subject,body").is("error", null).order("sent_at", { ascending: false }).limit(6);
  return (data ?? []).filter((e) => kind !== "saturday" || e.kind === "saturday").slice(0, 3);
}

const KIND_BRIEF: Record<Exclude<Kind, "alert">, string> = {
  monday: `This is MONDAY's email: set Miguel up for the week. Give 3–5 to-dos for the week in priority order (queue fills first: they make the site look complete).
Pick up to 10 queue venues to put first this week (planVenueIds) and a one-paragraph plan summary. Suggest one in-person trip this week (go) if it fits.`,
  thursday: `This is THURSDAY's email: a short check-in. Say plainly what got done since Monday (from the numbers), then list the 2–4 most important things left
this week. No guilt if little got done; just the next smallest step.`,
  saturday: `This is SATURDAY's email: thinking time. Give 2–3 fresh, concrete ideas for the bigger, less technical problems (getting an audience, getting venues to
pay, getting events without scraping), each with a first step he can take in 15 minutes. Example of the kind of idea he likes: asking Instagram accounts
that already find underground events to share their finds with Afoot. Don't repeat ideas from recent Saturday emails. Also pick where to go pitch in person (go):
one area and 2–4 venues there that haven't said yes or no, with a one-line opener he can say at the door.`,
};

interface Plan {
  subject: string; opening: string;
  todo: { title: string; why?: string; minutes?: number }[];
  research?: { eventId: string; ask?: string }[];
  go?: { area: string; venueIds: string[]; opener?: string } | null;
  ideas?: { idea: string; firstStep?: string }[];
  planVenueIds?: string[]; summary?: string;
}

async function writeDigest(kind: Exclude<Kind, "alert">, facts: Record<string, unknown>, ranking: string): Promise<Plan> {
  const system = `You write short, warm, direct emails to a solo founder about his events app. ${CONTEXT}
How to rank (the founder's own words; follow them):
${ranking}
Reply with JSON only: {"subject": string (under 60 chars), "opening": string (1–2 sentences), "todo": [{"title", "why", "minutes"}],
"research": [{"eventId", "ask"}] (0–3 picked from researchCandidates, highest traffic first; ask = what to look up),
"go": {"area", "venueIds", "opener"} or null, "ideas": [{"idea", "firstStep"}] (Saturday only, else []),
"planVenueIds": [] (Monday only), "summary": string (Monday only, else "")}. Use only ids that appear in the facts.`;
  const raw = await complete({ provider: "anthropic", model: DIGEST_MODEL, system, prompt: `${KIND_BRIEF[kind]}\n\nFacts (JSON):\n${JSON.stringify(facts)}`, maxTokens: 2500 });
  return JSON.parse(extractJson(raw)) as Plan;
}

/** Facts-only email, used when the AI call fails so an email still goes out. */
function fallbackPlan(kind: Kind, facts: { queueTop: { venue: string; kind: string; fixes: number }[]; researchCandidates: ResearchItem[] }): Plan {
  return {
    subject: `Afoot ${kind}: ${facts.queueTop.length} gaps to fill`,
    opening: "The AI planner didn't answer this morning, so here are the top items straight from the queue.",
    todo: facts.queueTop.slice(0, 4).map((c) => ({ title: `${c.kind === "address" ? "Add the address for" : "Add the price for"} ${c.venue}`, why: `fixes ${c.fixes} dates`, minutes: 2 })),
    research: facts.researchCandidates.slice(0, 3).map((r) => ({ eventId: r.eventId })),
  };
}

function render(kind: Kind, plan: Plan, research: ResearchItem[], goVenues: VenueStat[], footer: string) {
  const btn = (href: string, label: string) => `<p><a href="${href}" style="display:inline-block;background:#c026d3;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${label}</a></p>`;
  const h: string[] = [`<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#18181b;max-width:560px">`, `<p>${esc(plan.opening)}</p>`];
  const t: string[] = [plan.opening, ""];
  if (plan.todo?.length) {
    h.push(`<h3 style="margin-bottom:4px">To do</h3><ol>`); t.push("TO DO");
    plan.todo.forEach((x, i) => {
      const mins = x.minutes ? ` (~${x.minutes} min)` : "";
      h.push(`<li><b>${esc(x.title)}</b>${esc(mins)}${x.why ? `<br><span style="color:#52525b">${esc(x.why)}</span>` : ""}</li>`);
      t.push(`${i + 1}. ${x.title}${mins}${x.why ? ` — ${x.why}` : ""}`);
    });
    h.push(`</ol>`, btn(QUEUE, "Open the queue")); t.push("", `Open the queue: ${QUEUE}`, "");
  }
  if (research.length) {
    h.push(`<h3 style="margin-bottom:4px">Look these up by hand</h3><ul>`); t.push("LOOK THESE UP BY HAND");
    for (const r of research) {
      const ask = plan.research?.find((x) => x.eventId === r.eventId)?.ask;
      h.push(`<li><b>${esc(r.title)}</b> at ${esc(r.venue)}, ${esc(laDate(r.startsAt))}<br>Missing: ${esc(r.missing.join(", "))}${ask ? `. ${esc(ask)}` : ""}${r.link ? `<br><a href="${esc(r.link)}">event link</a>` : ""}</li>`);
      t.push(`- ${r.title} at ${r.venue}, ${laDate(r.startsAt)}. Missing: ${r.missing.join(", ")}${ask ? `. ${ask}` : ""}${r.link ? ` ${r.link}` : ""}`);
    }
    h.push(`</ul><p style="color:#52525b;font-size:14px">Fix the venue's address or price in the queue and every date there updates.</p>`); t.push("");
  }
  if (plan.go && goVenues.length) {
    h.push(`<h3 style="margin-bottom:4px">Where to go: ${esc(plan.go.area)}</h3><ul>`); t.push(`WHERE TO GO: ${plan.go.area}`);
    for (const v of goVenues) {
      const maps = `https://www.google.com/maps/search/${encodeURIComponent(`${v.name} ${v.address ?? ""}`)}`;
      h.push(`<li><b>${esc(v.name)}</b>, ${esc(v.address ?? "")} (<a href="${maps}">map</a>)${v.outreach_count ? ` · contacted ${v.outreach_count}×` : ""}</li>`);
      t.push(`- ${v.name}, ${v.address ?? ""} ${maps}`);
    }
    h.push(`</ul>`); t.push("");
    if (plan.go.opener) { h.push(`<p><i>Opener:</i> “${esc(plan.go.opener)}”</p>`); t.push(`Opener: "${plan.go.opener}"`, ""); }
    h.push(btn(`${QUEUE}?tab=outreach`, "Log who you talked to")); t.push(`Log who you talked to: ${QUEUE}?tab=outreach`, "");
  }
  if (plan.ideas?.length) {
    h.push(`<h3 style="margin-bottom:4px">Ideas to chew on</h3><ul>`); t.push("IDEAS");
    for (const i of plan.ideas) {
      h.push(`<li><b>${esc(i.idea)}</b>${i.firstStep ? `<br>First step: ${esc(i.firstStep)}` : ""}</li>`);
      t.push(`- ${i.idea}${i.firstStep ? ` First step: ${i.firstStep}` : ""}`);
    }
    h.push(`</ul>`); t.push("");
  }
  h.push(`<p style="color:#71717a;font-size:13px">${esc(footer)} Change how the AI ranks things: <a href="${QUEUE}?tab=prompt">AI prompt</a>.</p></div>`);
  t.push(footer, `AI prompt: ${QUEUE}?tab=prompt`);
  return { html: h.join("\n"), text: t.join("\n") };
}

/** Haiku scores a batch of events for traffic potential; returns those scored 4–5. */
async function highTraffic(items: ResearchItem[], ranking: string): Promise<{ id: string; ask: string }[]> {
  if (!items.length) return [];
  const list = items.slice(0, 80).map((r) => ({ id: r.eventId, title: r.title, venue: r.venue, category: r.category, when: laDate(r.startsAt) }));
  const raw = await complete({
    provider: "anthropic", model: ALERT_MODEL, maxTokens: 1500,
    system: `You score LA events for traffic potential on Afoot, a small-events site. ${ranking}\nReply with JSON only: {"high": [{"id", "score" (1-5), "ask"}]} listing only events scoring 4 or 5 (big draw, broadly appealing, likely shared). ask = what Miguel should look up. Use only the given ids.`,
    prompt: JSON.stringify(list),
  });
  const ids = new Set(list.map((l) => l.id));
  return ((JSON.parse(extractJson(raw)).high ?? []) as { id: string; score: number; ask: string }[])
    .filter((x) => ids.has(x.id) && x.score >= 4).slice(0, 5).map((x) => ({ id: x.id, ask: x.ask }));
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const forced = args.find((a) => ["monday", "thursday", "saturday", "alert"].includes(a)) as Kind | undefined;
  const la = laParts();
  const kind: Kind = forced ?? ({ Monday: "monday", Thursday: "thursday", Saturday: "saturday" } as Record<string, Kind>)[la.weekday] ?? "alert";
  if (!forced && (la.hour < 7 || la.hour > 11)) { console.log(`It's ${la.hour}:00 in LA; emails go out 7–11 a.m. Nothing to do.`); return; }
  const to = process.env.FOUNDER_EMAIL;
  if (!to && !dry) throw new Error("FOUNDER_EMAIL is not set");
  if (!dry) {
    const { data: done } = await supabase.from("founder_emails").select("id").eq("kind", kind).eq("la_day", la.day).is("error", null).maybeSingle();
    if (done) { console.log(`The ${kind} email for ${la.day} already went out.`); return; }
  }

  const ranking = (await getSetting("ranking_prompt")) ?? "Rank by traffic potential.";
  const [stats, research] = await Promise.all([venueStats(), researchCandidates(kind === "alert" ? 7 : 14)]);

  let plan: Plan, researchShown: ResearchItem[] = [], goVenues: VenueStat[] = [];
  if (kind === "alert") {
    const high = await highTraffic(research, ranking);
    if (!high.length) { console.log("No high-traffic events missing details this week. No email."); return; }
    researchShown = high.map((h) => research.find((r) => r.eventId === h.id)!);
    plan = { subject: `Afoot: ${high.length} big event${high.length > 1 ? "s" : ""} need details`, opening: "These look like big draws and are coming up soon, but they're missing details. A quick look-up each:", todo: [], research: high.map((h) => ({ eventId: h.id, ask: h.ask })) };
  } else {
    let planned: string[] = [];
    try { planned = JSON.parse((await getSetting("weekly_plan")) || "{}").venueIds ?? []; } catch { /* none */ }
    const cards = rankCards(stats, planned);
    const queueTop = cards.slice(0, 25).map((c) => ({ venueId: c.venue.id, venue: c.venue.name, kind: c.kind, fixes: c.fixes, soonDates: c.venue.soonDates, area: c.venue.area }));
    const facts = {
      today: `${la.weekday} ${la.day}`,
      totals: { upcomingDates: stats.reduce((n, v) => n + v.dates, 0), datesMissingAddress: stats.filter((v) => !v.address).reduce((n, v) => n + v.dates, 0), datesMissingPrice: stats.reduce((n, v) => n + v.noPriceDates, 0), queueCards: cards.length },
      doneLast7Days: await actionsSince(new Date(Date.now() - 7 * DAY).toISOString()),
      doneSinceMonday: kind === "thursday" ? await actionsSince(new Date(Date.now() - 3 * DAY).toISOString()) : undefined,
      queueTop,
      researchCandidates: research.slice(0, 40).map((r) => ({ eventId: r.eventId, title: r.title, venue: r.venue, when: laDate(r.startsAt), missing: r.missing, category: r.category })),
      outreachCandidates: kind === "thursday" ? undefined : outreachCandidates(stats),
      recentEmails: await recentEmails(kind),
    };
    try {
      plan = await writeDigest(kind, facts, ranking);
    } catch (e) {
      console.error(`AI plan failed: ${(e as Error).message}`);
      plan = fallbackPlan(kind, { queueTop, researchCandidates: research });
    }
    const byId = new Map(research.map((r) => [r.eventId, r]));
    researchShown = (plan.research ?? []).map((r) => byId.get(r.eventId)).filter(Boolean).slice(0, 3) as ResearchItem[];
    const statById = new Map(stats.map((v) => [v.id, v]));
    goVenues = (plan.go?.venueIds ?? []).map((id) => statById.get(id)).filter((v): v is VenueStat => Boolean(v?.address)).slice(0, 4);
    if (kind === "monday" && !dry) {
      const venueIds = (plan.planVenueIds ?? []).filter((id) => statById.has(id)).slice(0, 10);
      await setSetting("weekly_plan", JSON.stringify({ week: la.day, venueIds, summary: plan.summary ?? "" }));
    }
  }

  const footer = kind === "alert" ? "You get these only for big events coming up within a week." : `Next: ${kind === "monday" ? "Thursday check-in" : kind === "thursday" ? "Saturday ideas" : "Monday plan"}.`;
  const { html, text } = render(kind, plan, researchShown, goVenues, footer);
  if (dry) { console.log(`To: ${to ?? "(FOUNDER_EMAIL unset)"}\nSubject: ${plan.subject}\n\n${text}`); return; }

  let error: string | null = null;
  try { await sendEmail({ to: to!, subject: plan.subject, html, text }); } catch (e) { error = (e as Error).message; }
  await supabase.from("founder_emails").upsert({ kind, la_day: la.day, subject: plan.subject, body: text, error, sent_at: new Date().toISOString() }, { onConflict: "kind,la_day" });
  if (error) throw new Error(error);
  if (researchShown.length) await supabase.from("founder_alerts").upsert(researchShown.map((r) => ({ event_id: r.eventId })));
  console.log(`Sent the ${kind} email: ${plan.subject}`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
