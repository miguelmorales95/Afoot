# Phase 1: Exact Match Deduplication - SHIPPED

**Date:** 2026-11-23 | **Status:** Code ready, awaiting migration + testing

## What Was Built

### 1. Database Migration
**File:** `supabase/migrations/20261123000000_event_relationships.sql`

Creates:
- `event_relationships` table: tracks multi-venue events and fuzzy dedup matches
- `related_events()` RPC: queries all related events for a given event ID

**To apply:**
```bash
npm run migrate -- supabase/migrations/20261123000000_event_relationships.sql
```

### 2. Backend Dedup Logic
**File:** `lib/ingest.ts`

Added:
- `checkExactOccurrence()` function: queries for existing events at same venue + same date + same hour (±1h window)
- Phase 1 filtering: before inserting occurrences, checks for exact matches and skips them
- Logging: "deduplicated N exact occurrence(s)" when duplicates are caught

**How it works (corrected 2026-11-23, `duplicateDates()` in `lib/ingest.ts`):**
```
For each event in ingest:
  1. Create event record (upsert by dedupe_key, idempotent)
  2. Build occurrence rows (future dates, valid times)
  3. Dates this event already has are always kept (otherwise the stale-date step would
     delete them on every re-import)
  4. For its new dates, one query: another active event at the same venue, with a matching
     title (same words, or one contains the other; titles under 6 letters must match
     exactly), starting within an hour -> skip that date
  5. Different events at the same time (a museum film and a tour) don't match on title, so
     both stay
  6. If the check fails, nothing is skipped: the import never stops on dedup
```
The first version matched venue + hour only, and its query filter never matched, so it did
nothing; written as intended it would have deleted events' own dates and same-time events.

**Result:** Same event from newsletter + venue calendar won't create duplicate occurrences.

### 3. Frontend Display Component
**File:** `components/RelatedEventsLink.tsx`

Shows:
- **Small icon (🔗)** in event metadata (subtle, near the top but not prominent)
- **Expandable link at bottom:** "Also at: Venue Name 1, Venue Name 2"
- Click to expand → see all related events with dates
- Click related event → navigate to that event's detail page

**How to integrate:**
```tsx
// In your event card/detail component:
import { RelatedEventsIndicator } from '@/components/RelatedEventsLink';

<EventCard>
  <div className="flex justify-between">
    <h3>{event.title}</h3>
    <RelatedEventsIndicator eventId={event.id} />  {/* Small icon appears here */}
  </div>
  
  {/* ... rest of event card ... */}
  
  <RelatedEventsIndicator eventId={event.id} />  {/* Link appears at bottom */}
</EventCard>
```

## Testing Checklist

**Manual test:**
1. Apply migration: `npm run migrate -- supabase/migrations/20261123000000_event_relationships.sql`
2. Run ingest on a venue: `npm run ingest -- venue-slug`
3. Run ingest again on same venue: `npm run ingest -- venue-slug`
4. Check logs: should see "deduplicated X exact occurrence(s)" messages
5. Query DB:
   ```sql
   SELECT title, COUNT(*) as count
   FROM afoot.event_occurrences eo
   JOIN afoot.events e ON eo.event_id = e.id
   WHERE e.venue_id = 'venue-id'
   GROUP BY title
   HAVING count > 1;
   ```
   Should show minimal/zero results (only intentional multi-venue events)

**Frontend test:**
1. Add `<RelatedEventsIndicator eventId={event.id} />` to an event card
2. Load event detail page
3. Verify small 🔗 icon appears (subtle)
4. Verify link "Also at: ..." appears at bottom
5. Click to expand, verify related events show up

## What's NOT in Phase 1

- Fuzzy matching (threshold 80) → Phase 2
- Multi-venue linking → Phases 2–3
- Curator attribution → Phase 4

Phase 1 is **tight and low-risk:** just prevents exact duplicates from being inserted twice. No data merging, no fuzzy scoring, just simple "did we already ingest this exact occurrence?"

## Next Steps

1. **Apply the migration** (use `npm run migrate` or Supabase dashboard)
2. **Test with one venue** (run ingest twice, check logs)
3. **If good:** merge to main
4. **Then:** Phase 2 (fuzzy match, threshold 80, event_relationships linking)

## Questions?

Refer to `dedup-simplified-checklist.md` for Phase 2 implementation.
