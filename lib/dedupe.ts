// Are two listings the same event? Used at import, in the events feed, and by the cleanup script.
//
// Blocking does most of the work: only events at the SAME venue starting within an hour are ever
// compared. Within that block, titles only need to share their meaningful words, because sources
// (and the extraction model, night to night) dress the same show differently:
//   "David Benoit: A Charlie Brown Christmas"
//   "DAVID BENOIT: A CHARLIE BROWN CHRISTMAS (Grammy Award-nominated Pianist, KJAZZ Host)"
//   "David Benoit: A Charlie Brown Christmas (with special guest Courtney Fortune)"
// Different things at one venue at one time (a film and a tour) share no meaningful words, so stay apart.

// Words that say nothing about which event it is.
const NOISE = new Set(
  ("a an the and or of with w at in on for by to from vs featuring feat ft special guest guests presents presented " +
    "present live show shows night nights concert concerts tour event events performance performances tribute " +
    "evening matinee edition series session sessions part pt tickets ticket plus free all ages new annual " +
    "grammy award nominated winning host hosted pianist").split(" "),
);

export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      // Clock times say nothing ("(3:00pm session)"); other numbers do ("Session 1" vs "Session 2").
      .replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\b\d{1,2}:\d{2}\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w && (w.length > 1 || /\d/.test(w)) && !NOISE.has(w))
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)), // "Tuesdays" = "Tuesday"
  );
}

/** Same event, assuming same venue and start within an hour. */
export function similarTitles(a: string, b: string): boolean {
  const x = titleWords(a), y = titleWords(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let shared = 0;
  for (const w of small) if (big.has(w)) shared++;
  // One title's meaningful words are all in the other ("Trivia" / "Trivia with Epic Pub Quiz"),
  // or nearly all words overall are shared. A looser overlap merged different things that share a
  // series name ("Adult Karate, Beginning" / "…, Intermediate"; "Unsung 80s Soundtracks: Naza" /
  // "…: Christiane F."; "… with San Diego Waves" / "… with OC Waves").
  const union = x.size + y.size - shared;
  return shared === small.size || (shared >= 2 && shared / union >= 0.7);
}

export const SAME_TIME_MS = 60 * 60 * 1000;
