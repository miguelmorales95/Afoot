# Duplicate events: research, what we tried, what we learned

The running record for how Light Pole decides two listings are the same event. Newest learnings
at the top of each section. Code: [lib/dedupe.ts](../../lib/dedupe.ts) (the rule),
[lib/ingest.ts](../../lib/ingest.ts) (at import), [app/api/events/route.ts](../../app/api/events/route.ts)
(feed safety net), [scripts/merge-dupes.ts](../../scripts/merge-dupes.ts) and
[scripts/dedupe-occurrences.ts](../../scripts/dedupe-occurrences.ts) (cleanup).

## How others approach it

Matching duplicate records is a well-studied problem ("entity resolution"). The common shape:

1. **Normalize** each record (case, punctuation, accents, time zone).
2. **Block**: only compare records that could plausibly match, using a cheap key. For events the
   natural block is *same venue + start time within a window*. Blocking does most of the work and
   keeps comparisons fast.
3. **Compare** pairs inside a block with a similarity score. For short names, word-based measures
   (shared words regardless of order, "token set" or Jaccard) beat character edit distance,
   because sources add and drop whole phrases ("with special guest…", "(Night 1)").
4. **Cluster** matches into groups, **without chaining**: if A matches B and B matches C, A and C
   may still be different (a generic title in the middle links unrelated things). Join a group
   only when matching all members, or link everything to one canonical record.
5. **Pick a survivor** (canonical record) and merge the rest into it, keeping the most reliable
   fields.
6. **Use hard IDs first** when sources give them: a ticket or event-detail URL, a DICE / Eventbrite /
   Ticketmaster event ID. Concert aggregators lean on *performer + venue + date* rather than the
   event title, since titles are marketing copy and vary most.
7. **Send the borderline cases to a judge** (a person, or an AI asked "same event?") instead of
   loosening the automatic rule until it makes mistakes.

The lesson that matters most for us: **don't make the identity depend on a field that changes.**
Our titles are written by the extraction AI every night, so they drift.

## What we tried and learned

**2026-11-24: identity by venue + time + similar title (fixed the Catalina "David Benoit" ×5).**
- *Cause:* an event's key was `venue + exact title`. Each night the AI reworded the title
  ("…(with Courtney Fortune)", "…(Grammy Award-nominated Pianist, KJAZZ Host)"), so each rewording
  became a new event with the same dates.
- *Second cause:* `merge-dupes` (v1) read events without paging; the database returns at most
  1,000 rows per request, so it only ever saw the first 1,000 of ~5,800 events. **Lesson: every
  script that scans a whole table must page.**
- *First rule tried:* titles match if 60% of the smaller title's meaningful words are shared.
  It merged real duplicates, but also "Adult Karate, Beginning" with "…, Intermediate",
  "…with San Diego Waves" with "…with OC Waves", and chained two different films through a series
  name ("Unsung 80s Soundtracks").
- *Rule now:* same venue, start within an hour, and either all of one title's meaningful words are
  in the other, or 70%+ of all words are shared. "Meaningful" drops filler ("with", "special
  guest", "presents", "tribute", "live"), clock times ("3:00pm"), and plurals ("Tuesdays" =
  "Tuesday"); **numbers are kept** so "Session 1" ≠ "Session 2". Groups join only when matching
  every member (no chaining).
- *Result:* 360 copy events and ~750 duplicate dates merged; 61 dates that only a copy had were
  moved to the kept event. No RSVPs or chats were affected.
- *Known miss:* "Season 1 Episodes 1-4" vs "Season 2 Episodes 1-4" merge, because "1" is in both.

**2026-11-23: multi-day runs re-saved every scrape (Photos with Santa ×3).**
- Pages that say "through Dec 24" give no start date, so each scrape used that day as the start.
  Now a run that starts inside a run the event already has is the same run (start kept, end
  updated). 88 copies removed.

**2026-11-23: same event from two sources (newsletter + calendar).**
- New dates already listed by a matching event at the same venue within an hour are skipped.
  Only stops *new* copies; old ones needed the cleanup above.

**Earlier: per-venue exact title key** (`venue_id:slug(title)`). Works only when titles never change.

## Where each rule runs

| Where | What it does |
|---|---|
| Import (`lib/ingest.ts`) | A reworded listing of an event this **same source** already has updates that event and keeps its title. A date another source already lists is skipped. A repeated run keeps its original start. |
| Events feed (`app/api/events/route.ts`) | Safety net: two events at one venue within an hour with similar titles show as one card (the better-ranked); one card per run. |
| Cleanup (`npm run merge-dupes`, `npm run dedupe-occurrences`) | Merges stored duplicates with the same rule; repeats passes until none are left; never deletes a date with RSVPs or chat. Run `--dry-run` first and read the list. |

Merging is limited to the same source on purpose: a venue's page is the authority for its own
event's dates, and absorbing a newsletter's event into it would let the next page read delete
dates only the newsletter listed. Cross-source copies are hidden in the feed instead.

## Next ideas, roughly in order of value

1. **Hard IDs**: store the ticket / event-detail URL when it's event-specific (not the venue's
   calendar page) and treat a matching URL as the same event, before any title logic.
2. **Run `merge-dupes` nightly** after the import (one line in `.github/workflows/ingest.yml`).
3. **Performer as identity** for music: have extraction return the headliner, and match on
   headliner + venue + date. Fixes bills listed band by band ("Babe Ruthless" / "Bed Bug Guru").
4. **AI judge for borderline pairs** (some shared words but below the rule), or an admin review list.
5. **Cross-source merge with field-level survivorship** (keep each source's dates, prefer the
   venue's title), if feed-level hiding stops being enough.
