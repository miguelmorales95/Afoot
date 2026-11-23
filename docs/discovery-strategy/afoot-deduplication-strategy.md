# Afoot Deduplication Strategy: Multi-Source Strict Dedup

**Problem:** With 6+ event sources (venue calendars, newsletters, Eventbrite, event links, calendar feeds, IG curators), the same event can appear multiple times before hitting the site.

**Current dedup:** Per-venue title match only (`venue_id:slugify(title)`). Not sufficient.

**Goal:** Catch duplicates **before** they hit the database, merge intelligently, and maintain audit trail.

---

## Deduplication Layers

```
Event arrives from source (venue calendar, newsletter, link, curator, etc.)
         ↓
Layer 1: Normalize (title, time, venue)
         ↓
Layer 2: Check existing occurrences (same time + venue → same event)
         ↓
Layer 3: Fuzzy match title + time (within window → likely same event)
         ↓
Layer 4: Check curator/source credits (avoid duplicate credit attribution)
         ↓
         ✓ Unique → Upsert
         ✓ Duplicate → Merge/Update
         ✗ Uncertain → Flag for manual review
```

---

## Layer 1: Normalize Input

**Before any dedup logic, normalize every event:**

```typescript
interface NormalizedEvent {
  title_normalized: string;        // lowercase, punctuation removed, deduplicated spaces
  starts_at_epoch: number;         // unix milliseconds (LA timezone)
  starts_at_date: string;          // ISO date (LA timezone, YYYY-MM-DD)
  venue_id: string | null;         // matched venue, or null if unknown
  venue_name_normalized: string;   // from event or venue lookup
  url_domain: string | null;       // domain of event link (eventbrite.com, etc.)
  source: 'website' | 'newsletter' | 'link' | 'eventbrite' | 'ticketmaster' | 'feed' | 'curator';
  source_url: string | null;       // where it came from
  confidence: 'high' | 'medium' | 'low';
}

function normalizeEventTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')          // remove punctuation
    .replace(/\s+/g, ' ')              // deduplicate spaces
    .trim()
    .slice(0, 150);                    // cap at 150 chars (prevents weird long titles)
}

function normalizeVenueName(s: string): string {
  return s.toLowerCase()
    .replace(/\b(the|at|&)\b/g, '')   // drop common articles
    .replace(/\s+/g, ' ')
    .trim();
}
```

**Normalize before every dedup check**, so you're comparing apples-to-apples.

---

## Layer 2: Exact Occurrence Match (Strongest Signal)

**If the same venue has an event at the exact same time, it's the same event.**

```sql
-- Check if this exact occurrence already exists
SELECT events.id, event_occurrences.id
FROM events
JOIN event_occurrences ON events.id = event_occurrences.event_id
WHERE events.venue_id = $1
  AND DATE(event_occurrences.starts_at AT TIME ZONE 'America/Los_Angeles') = $2
  AND EXTRACT(HOUR FROM event_occurrences.starts_at AT TIME ZONE 'America/Los_Angeles') = $3
  AND events.cancelled = false
LIMIT 1;
```

**Logic:**
- If a match exists:
  - **Exact venue + exact date + exact hour** → Same occurrence, update metadata
  - **Exact venue + exact date + different hour** → Might be different showtime, review title
  - **Different venue + exact date + exact hour** → Probably different events (different locations)

**Implementation:** Before inserting a new event occurrence, check for existing one at the exact time/venue. If found, merge sources instead of creating new.

---

## Layer 3: Fuzzy Title + Time Match (Medium Signal)

**For the same venue, if titles are similar and times are close, it's likely the same event.**

```typescript
interface FuzzyMatch {
  event_id: string;
  title: string;
  starts_at: Date;
  score: number;  // 0-100, higher = more confident it's a duplicate
}

function fuzzyScore(
  newTitle: string,
  existingTitle: string,
  newTime: number,
  existingTime: number,
): number {
  // Levenshtein distance (or simpler: common word ratio)
  const commonWords = newTitle.split(' ')
    .filter(w => existingTitle.includes(w)).length;
  const totalWords = Math.max(newTitle.split(' ').length, existingTitle.split(' ').length);
  const titleSimilarity = commonWords / totalWords * 100;
  
  // Time proximity (same day = 50 points, within 2 hours = 30 points, within 6 hours = 10 points)
  const hoursDiff = Math.abs((newTime - existingTime) / (1000 * 3600));
  let timeSimilarity = 0;
  if (hoursDiff < 1) timeSimilarity = 50;
  else if (hoursDiff < 2) timeSimilarity = 30;
  else if (hoursDiff < 6) timeSimilarity = 20;
  
  // If titles are >70% similar AND times are within 6 hours, it's probably a dupe
  return (titleSimilarity + timeSimilarity) / 2;
}

async function findFuzzyMatches(
  newEvent: NormalizedEvent,
  venueId: string,
  windowHours = 6,
): Promise<FuzzyMatch[]> {
  const { data } = await supabase
    .from('events')
    .select('id, title, event_occurrences(starts_at)')
    .eq('venue_id', venueId)
    .eq('cancelled', false)
    .gte('event_occurrences.starts_at', new Date(newEvent.starts_at_epoch - windowHours * 3600 * 1000).toISOString())
    .lte('event_occurrences.starts_at', new Date(newEvent.starts_at_epoch + windowHours * 3600 * 1000).toISOString());
  
  return (data ?? [])
    .flatMap(e => (e.event_occurrences ?? []).map(occ => ({
      event_id: e.id,
      title: e.title,
      starts_at: new Date(occ.starts_at),
      score: fuzzyScore(newEvent.title_normalized, normalizeEventTitle(e.title), newEvent.starts_at_epoch, occ.starts_at.getTime()),
    })))
    .filter(m => m.score >= 65);  // 65+ = likely a dupe
}
```

**Logic:**
- **Score ≥ 85:** Merge silently (high confidence duplicate)
- **Score 65–84:** Merge but log for review (medium confidence)
- **Score < 65:** Create new event (low confidence)

---

## Layer 4: Cross-Source Deduplication (Before Storing)

**Different sources might report the same event at the same venue. Dedupe before writing.**

```typescript
async function detectDuplicate(
  newEvent: NormalizedEvent,
  venueId: string,
): Promise<{ isDuplicate: boolean; existingEventId?: string; mergeStrategy?: 'merge' | 'review' | 'separate' }> {
  
  // 1. Exact occurrence match (strongest)
  const existing = await supabase
    .from('event_occurrences')
    .select('event_id')
    .eq('event_id:events.venue_id', venueId)
    .eq('cancelled', false)
    .single();
  
  if (existing.data?.event_id) {
    return { isDuplicate: true, existingEventId: existing.data.event_id, mergeStrategy: 'merge' };
  }
  
  // 2. Fuzzy match
  const fuzzy = await findFuzzyMatches(newEvent, venueId);
  if (fuzzy.length > 0) {
    const best = fuzzy[0];
    return {
      isDuplicate: true,
      existingEventId: best.event_id,
      mergeStrategy: best.score >= 85 ? 'merge' : 'review'
    };
  }
  
  // 3. Cross-venue fuzzy match (collaborative events)
  if (newEvent.venue_id) {
    const crossVenue = await supabase
      .rpc('find_similar_events', {
        title: newEvent.title_normalized,
        venue_name: newEvent.venue_name_normalized,
        time_window_hours: 2,
      });
    
    if (crossVenue.data?.length > 0) {
      return {
        isDuplicate: true,
        existingEventId: crossVenue.data[0].event_id,
        mergeStrategy: 'review'  // human review for multi-venue
      };
    }
  }
  
  // Not a duplicate
  return { isDuplicate: false };
}
```

---

## Layer 5: Source Deduplication (Curator / Link Credit)

**When the same source or curator posts the same event, don't duplicate the credit.**

```typescript
interface EventSource {
  source: 'website' | 'newsletter' | 'link' | 'eventbrite' | 'ticketmaster' | 'feed' | 'curator';
  source_id?: string;  // curator handle, Eventbrite id, etc.
  url?: string;        // source link
  credited_to?: string; // "Discovered by @username"
}

async function mergeEventSources(
  existingEventId: string,
  newEvent: NormalizedEvent,
  newSource: EventSource,
): Promise<void> {
  // Get existing sources
  const { data: existing } = await supabase
    .from('events')
    .select('source, sources_json')  // assume sources_json is a list of source records
    .eq('id', existingEventId)
    .single();
  
  const existingSources = existing.sources_json ?? [];
  
  // Don't add duplicate source
  const sourceKey = `${newSource.source}:${newSource.source_id ?? newSource.url}`;
  const isDuplicateSource = existingSources.some(s => 
    `${s.source}:${s.source_id ?? s.url}` === sourceKey
  );
  
  if (!isDuplicateSource) {
    existingSources.push(newSource);
    await supabase
      .from('events')
      .update({
        sources_json: existingSources,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingEventId);
  }
}
```

---

## Layer 6: Manual Review Queue

**Uncertain duplicates go to `/admin` for review, not auto-merged.**

```sql
-- New table: flagged for review
CREATE TABLE IF NOT EXISTS dedup_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_1 UUID NOT NULL REFERENCES events(id),
  event_id_2 UUID NOT NULL REFERENCES events(id),
  score NUMERIC,              -- fuzzy match score
  reason TEXT,                -- why it was flagged
  status TEXT DEFAULT 'pending', -- pending | approved_merge | approved_separate | rejected
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**When to flag for review:**
- Fuzzy score 65–84 (medium confidence)
- Different venues, similar titles
- Curator posted same event but different title
- Eventbrite and venue calendar both list it differently

**In `/admin`:**
- Show the two events side-by-side
- One-click "Merge" or "Keep Separate"
- Track merge decisions for ML training

---

## Implementation: Pre-Ingestion Dedup

**Add this BEFORE `storeExtractedEvents` in `lib/ingest.ts`:**

```typescript
export async function dedupExtractedEvents(
  events: ExtractedEvent[],
  venueId: string,
  source: EventSource,
  log?: (s: string) => void,
): Promise<{ events: ExtractedEvent[]; duplicates: Array<{ event: ExtractedEvent; existingId: string; strategy: string }> }> {
  const duplicates = [];
  const unique = [];
  
  for (const ev of events) {
    const normalized: NormalizedEvent = {
      title_normalized: normalizeEventTitle(ev.title),
      venue_id: venueId,
      venue_name_normalized: ev.venue_name ? normalizeVenueName(ev.venue_name) : '',
      starts_at_epoch: Date.parse(ev.occurrences[0]?.start ?? new Date().toISOString()),
      starts_at_date: ev.occurrences[0]?.start?.split('T')[0] ?? '',
      url_domain: null,
      source: source.source,
      source_url: source.url ?? null,
      confidence: 'medium',
    };
    
    const dup = await detectDuplicate(normalized, venueId);
    
    if (dup.isDuplicate && dup.mergeStrategy === 'merge') {
      log?.(`  ~ "${ev.title}" is a duplicate of event ${dup.existingEventId} (high confidence)`);
      duplicates.push({ event: ev, existingId: dup.existingEventId!, strategy: 'merge' });
      // Don't add to unique
    } else if (dup.isDuplicate && dup.mergeStrategy === 'review') {
      log?.(`  ? "${ev.title}" might be a duplicate (medium confidence, flagged for review)`);
      duplicates.push({ event: ev, existingId: dup.existingEventId!, strategy: 'review' });
      // Add to dedup_review table, then optionally skip for now or add with low confidence
      unique.push(ev);
    } else {
      unique.push(ev);
    }
  }
  
  return { events: unique, duplicates };
}

// In ingestVenue:
const { events, duplicates } = await dedupExtractedEvents(events, venue.id, { source: 'website', url }, log);

if (duplicates.length) {
  log(`  Found ${duplicates.length} possible duplicate(s)`);
  for (const dup of duplicates.filter(d => d.strategy === 'review')) {
    await supabase.from('dedup_review').insert({
      event_id_1: dup.existingId,
      event_id_2: null,  // Will be populated after event is created (if at all)
      reason: `Fuzzy match: "${dup.event.title}"`,
      status: 'pending',
    });
  }
}

const occurrenceCount = await storeExtractedEvents({
  venueId: venue.id,
  events,  // Only unique events, dedups removed
  source: 'website',
  fallbackUrl: url,
  log,
});
```

---

## Schema Changes

```sql
-- Add to events table (if not present)
ALTER TABLE events ADD COLUMN IF NOT EXISTS sources_json JSONB DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES events(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS has_duplicates BOOLEAN DEFAULT false;

-- New table for dedup review queue
CREATE TABLE IF NOT EXISTS dedup_review (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_1 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_id_2 UUID REFERENCES events(id) ON DELETE CASCADE,
  score NUMERIC,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved_merge', 'approved_separate', 'rejected')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dedup_review_status ON dedup_review(status);
```

---

## `/admin` Integration

**New section: Deduplication Review**

```
┌─────────────────────────────────┐
│ Deduplication Review            │
│ 5 pending, 23 approved this week│
└─────────────────────────────────┘

[  ] "Trivia Night at the Hive" (2026-11-29 7pm)
      vs.
      "Tuesday Trivia" (2026-11-29 7pm, 50m away)
      Score: 73% | Venue: The Hive vs. The Hive Brewing
      
      [🔗 Merge]  [✗ Keep Separate]  [❓ Review Later]

[  ] "Open Mic" (2026-12-01 9pm, Highland Park Arts Center)
      vs.
      "Mic Night" (2026-12-01 8:45pm, same venue)
      Score: 82% | Venue: Same
      
      [🔗 Merge]  [✗ Keep Separate]
```

---

## Expected Impact

| Scenario | Before | After |
|---|---|---|
| Same event: venue calendar + newsletter | 2 entries | 1 entry (merged) |
| Same event: different venues (collab) | 2 entries | 2 entries (reviewed) or 1 (merged) |
| Similar but different events (Trivia vs. Music) | 1 entry each | 1 entry each (fuzzy match rejects false positives) |
| Curator posts event already in system | 2 entries | 1 entry (source added) |
| User submits Eventbrite link, already ingested | 2 entries | 1 entry (merged) |

---

## Rollout Plan

**Phase 1 (Week 1):**
- [ ] Implement Layer 1 (normalization) in `lib/ingest.ts`
- [ ] Implement Layer 2 (exact occurrence match)
- [ ] Deploy, monitor for false negatives

**Phase 2 (Week 2):**
- [ ] Implement Layer 3 (fuzzy match)
- [ ] Implement Layer 4 (cross-source)
- [ ] Add `dedup_review` table, build `/admin` UI for review queue

**Phase 3 (Week 3–4):**
- [ ] Run dedup on existing events (backfill)
- [ ] Monitor review queue, tune fuzzy score threshold
- [ ] Implement Layer 5 (source deduplication)

**Testing:**
- Manually ingest same event twice from different sources, verify dedup
- Test fuzzy matching with slightly different titles
- Verify that RSVPs/chat don't get lost in merges

---

## Why This Matters for Your Discovery Plan

With newsletters + IG curators incoming:
- **Same event in KCRW email and venue calendar** → dedupe automatically
- **Curator posts event that's on a venue calendar** → merge sources, credit curator
- **Multiple curators post same event** → dedupe, credit the first one
- **Eventbrite + newsletter both mention event** → merge, keep both sources

**Without this:** 50 events/month becomes 100+ (half duplicates). Users see the same event 3 times, trust in the site drops.

**With this:** 50 quality, non-duplicated events. Users trust Afoot to show them real variety.
