// The traffic formula: how big a draw an event is likely to be, 1–100. Plain arithmetic on facts
// we already have, run nightly by scripts/rank.ts; no AI per event. Tune the numbers here.
//   ~90  a festival at a famous venue      ~50  a typical show at a known spot
//   ~25  a weekly meeting at a library

export interface RankInput {
  venueDraw: number;      // 1–100 (Wikipedia page views, weekly; 30 when unknown)
  title: string;
  category: string | null;
  recurring: boolean;
  dates: number;          // dates in the next 60 days
  weekendDates: number;   // of those, Friday evening through Sunday
  free: boolean;
  clicks7: number;        // taps in the last 7 days
  clicksPrev7: number;    // taps in the 7 days before that
}

const CATEGORY: Record<string, number> = { music: 10, comedy: 8, market: 8, food: 6, games: 3, trivia: 3, karaoke: 3, class: -4 };

// Big one-time draws, and things few people go out for.
const BIG = /\b(festival|fest|fair|parade|carnival|fireworks|block party|night market|tree lighting|holiday market|premiere|opening night|concert|marathon|celebration|showcase|street fair|drag show|pop[- ]up)\b/i;
// Campus and classroom events: real, but mostly for students and families of performers.
const STUDENT = /\b(students?|recital|seminar|choir|chorale|chorus|glee club|ensemble|juries|master ?class|faculty|alumni|colloquium|symposium|lecture|thesis|workshop series)\b/i;
const SMALL = /\b(meeting|council|committee|commission|hearing|office hours|orientation|info(rmation)? session|registration|deadline|webinar|zoom|virtual|online|students only|members only|story ?time|tutoring|study hall|board of)\b/i;

export function trafficScore(x: RankInput): number {
  let s = 20 + 0.55 * x.venueDraw;
  s += CATEGORY[x.category ?? ""] ?? 0;
  if (!x.recurring && x.dates <= 2) s += 10;   // one-offs draw more than the weekly regular
  else if (x.dates >= 8) s -= 6;
  if (x.weekendDates > 0) s += 4;
  if (x.free) s += 3;
  if (BIG.test(x.title)) s += 12;
  if (SMALL.test(x.title)) s -= 20;
  else if (STUDENT.test(x.title)) s -= 12;
  // Taps: a little credit for being tapped, more for taking off (going viral).
  s += Math.min(10, 2.5 * Math.log2(1 + x.clicks7));
  if (x.clicks7 >= 5) s += Math.max(0, Math.min(15, 6 * Math.log2((x.clicks7 + 1) / (x.clicksPrev7 + 1))));
  return Math.max(1, Math.min(100, Math.round(s)));
}

/** Venue draw from average monthly Wikipedia page views: 0 → 15, 1k → 54, 100k → 80, 1M → 93.
 *  Schools and libraries are famous but most of their events are small, so they cap at 40
 *  (their sports teams don't). */
export function drawFromViews(monthlyViews: number | null, venueName = ""): number {
  const draw = monthlyViews == null ? 30 : Math.max(10, Math.min(100, Math.round(15 + 13 * Math.log10(monthlyViews + 1))));
  const campus = /\b(university|college|school|institute|library|seminary|academy)\b/i.test(venueName) && !/\bathletics\b/i.test(venueName);
  return campus ? Math.min(draw, 40) : draw;
}
