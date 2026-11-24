# Afoot Deduplication: Final Decisions

> **Update 2026-11-24:** what was built, what failed, and the current rule are in
> [dedup-research-and-learnings.md](dedup-research-and-learnings.md). The "fuzzy threshold 80" plan below
> was never built; the word-based rule there replaced it.


**Date:** 2026-11-23 | **Decision Maker:** Miguel Morales

---

## Decision 1: Backfill Existing Events
**Decision:** Keep the existing ~3,400 events as-is. Only deduplicate new events going forward.

**Why:** Faster to ship, reduces risk of accidentally merging unrelated events, cleaner data for April audience push (new events are guaranteed dedup'd).

**Implementation:** Dedup logic runs on all new events, but we don't run it retroactively on existing DB.

---

## Decision 2: Fuzzy Match Threshold
**Decision:** Set fuzzy match threshold to **80** (instead of 65–85 range).

**Scoring:**
- **Score ≥80:** Auto-merge (high confidence, same event)
- **Score <80:** Keep separate (low confidence, treat as different events)

**Why:** Removes the "medium confidence / review queue" middle ground. Either confident it's a dupe or we keep them separate. Simpler implementation, fewer edge cases.

**Example fuzzy scores:**
- "Trivia Night" vs. "Tuesday Trivia" (same time/venue) → 85+ ✓ auto-merge
- "Open Mic" vs. "Mic Night" (same time/venue) → 82+ ✓ auto-merge
- "Trivia 7pm" vs. "Trivia 8:45pm" (same venue, 1h45m apart) → 65 ✗ keep separate
- "Karaoke" vs. "Live Music" → 20 ✗ keep separate

---

## Decision 3: Multi-Venue Events
**Decision:** Keep as **separate events**, but visually link them with a prominent indicator.

**Why:** 
- Preserves Afoot's neighborhood-focused feel (same event at different venues might feel different to users)
- Simpler dedup logic (no complex merge handling)
- Allows venue-specific details (different address, parking, crowd vibe, etc.)
- Users can RSVP to their preferred location

**Display:** Add a **"Linked Event" indicator** at the top of the event card/page that shows related occurrences at other venues.

**Example:**
```
┌──────────────────────────────────────┐
│ ⊙ Related Events at Other Locations  │  ← New prominent indicator
├──────────────────────────────────────┤
│                                      │
│ TRIVIA NIGHT                         │
│ The Hive Brewing – Torrance          │
│ Tue Nov 29 · 7:00 PM                 │
│ $5 entry · Trivia                    │
│                                      │
│ [RSVP] [Share] [Flag]                │
│                                      │
│ ───────────────────────────────────  │
│ This event is also at:               │
│ • The Hive Downtown (Nov 29, 7pm)    │
│ • Brewgrub - Silver Lake (Nov 29, 7pm)
│                                      │
└──────────────────────────────────────┘
```

---

## Decision 4: Visual Indicator Design

**Goals:**
- Catch user attention immediately (not buried in details)
- Communicate "this event has related versions" clearly
- Encourage exploration ("what's different about the other location?")
- Not overwhelming/intrusive

**Options Tested:**

### Option A: Link Chain Icon + Label (Recommended)
```
⊙ Related Events at Other Locations
```
- **Pros:** Clear, scannable, prominent, curious-making
- **Cons:** Takes up space in card header
- **Icon:** Chained circles or link icon, slightly larger (16–18px)
- **Placement:** Right under event title, before or alongside category tag

### Option B: Subtle Badge (Less Intrusive)
```
[🔗 +2 More Locations]
```
- **Pros:** Compact, can fit in tag row
- **Cons:** Might be missed, less discoverable
- **Placement:** Next to category tags (Trivia, $5, etc.)

### Option C: Top Banner (Most Prominent)
```
⊙ ALSO AT OTHER VENUES ↓
─────────────────────────
Trivia Night
The Hive - Torrance
...
```
- **Pros:** Impossible to miss
- **Cons:** Takes up real estate, might feel pushy

---

## Final Design: Option A (Link Chain)

**UI Implementation:**

**On Event Card (List View):**
```
┌─────────────────────────────────────┐
│ ⊙ 2 other locations                 │  ← Tappable, opens modal/collapse
│ TRIVIA NIGHT                        │
│ The Hive - Torrance                 │
│ Tue Nov 29 · 7:00 PM                │
│ $5 entry · Trivia                   │
└─────────────────────────────────────┘
```

**On Event Detail Page:**
```
┌────────────────────────────────────────┐
│ ⊙ Related Events at Other Locations    │  ← Click to expand or scroll to section
├────────────────────────────────────────┤
│ TRIVIA NIGHT                           │
│ The Hive Brewing – Torrance            │
│ Tue Nov 29 · 7:00 PM                   │
│ ...                                    │
│                                        │
│ [Show other locations ↓]               │
└────────────────────────────────────────┘

[Expanded view below:]

─ Other Venues ─
• The Hive Downtown, Los Angeles
  Tue Nov 29 at 7:00 PM
  [View] [RSVP to this one]

• Brewgrub – Silver Lake
  Tue Nov 29 at 7:00 PM
  [View] [RSVP to this one]
```

**Icon Choice:**
- **⊙** (circled dot, U+2299) or **🔗** (link, emoji) or **◉** (open circle)
- Color: Brand accent color (not neutral gray, so it stands out)
- Size: 16–18px
- Hover state: Slightly larger or color change (indicates interactivity)

**Styling:**
```css
.linked-events-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--accent-color);  /* e.g., #0066cc */
  cursor: pointer;
  margin-bottom: 8px;
}

.linked-events-indicator:hover {
  opacity: 0.8;
  text-decoration: underline;
}

.linked-events-icon {
  font-size: 16px;
  display: inline-flex;
}
```

---

## Implementation Details

### Schema Changes
```sql
-- New table to track event relationships
CREATE TABLE IF NOT EXISTS event_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id_1 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_id_2 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'multi_venue',  -- 'multi_venue', 'similar', 'related'
  confidence NUMERIC,  -- fuzzy match score (80-100)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id_1, event_id_2)
);

CREATE INDEX idx_event_relationships_primary ON event_relationships(event_id_1);
CREATE INDEX idx_event_relationships_secondary ON event_relationships(event_id_2);
```

### Code Changes

**In `dedupExtractedEvents()` (after detecting fuzzy match with score ≥80):**
```typescript
if (dup.isDuplicate && dup.score >= 80) {
  // Instead of merging, create a relationship record
  await supabase.from('event_relationships').upsert({
    event_id_1: dup.existingEventId,
    event_id_2: newEventId,  // Will be populated after event is created
    relationship_type: 'multi_venue',
    confidence: dup.score,
  }, { onConflict: 'event_id_1,event_id_2' });
  
  log(`  ~ "${ev.title}" linked to existing event ${dup.existingEventId} (fuzzy match: ${dup.score}%)`);
}
```

**New RPC: Get related events**
```sql
CREATE OR REPLACE FUNCTION related_events(event_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  venue_id UUID,
  venue_name TEXT,
  starts_at TIMESTAMPTZ,
  confidence NUMERIC
) AS $$
  SELECT 
    COALESCE(e1.id, e2.id),
    COALESCE(e1.title, e2.title),
    COALESCE(e1.venue_id, e2.venue_id),
    COALESCE(v1.name, v2.name),
    COALESCE(eo1.starts_at, eo2.starts_at),
    er.confidence
  FROM event_relationships er
  LEFT JOIN events e1 ON er.event_id_1 = e1.id
  LEFT JOIN events e2 ON er.event_id_2 = e2.id
  LEFT JOIN venues v1 ON e1.venue_id = v1.id
  LEFT JOIN venues v2 ON e2.venue_id = v2.id
  LEFT JOIN event_occurrences eo1 ON e1.id = eo1.event_id
  LEFT JOIN event_occurrences eo2 ON e2.id = eo2.event_id
  WHERE (er.event_id_1 = event_id OR er.event_id_2 = event_id)
  ORDER BY COALESCE(eo1.starts_at, eo2.starts_at) ASC;
$$ LANGUAGE SQL;
```

**Frontend component (React):**
```typescript
// EventLinkedIndicator.tsx
export function EventLinkedIndicator({ eventId, onClick }: { eventId: string; onClick: () => void }) {
  const { data: relatedEvents } = useQuery(
    ['related-events', eventId],
    () => supabase.rpc('related_events', { event_id: eventId })
  );

  if (!relatedEvents?.length) return null;

  return (
    <button onClick={onClick} className="linked-events-indicator">
      <span className="linked-events-icon">⊙</span>
      <span>
        {relatedEvents.length} other {relatedEvents.length === 1 ? 'location' : 'locations'}
      </span>
    </button>
  );
}

// In EventCard.tsx or EventDetail.tsx:
const [showRelated, setShowRelated] = useState(false);

<EventLinkedIndicator 
  eventId={event.id} 
  onClick={() => setShowRelated(!showRelated)} 
/>

{showRelated && (
  <RelatedEventsList eventId={event.id} />
)}
```

---

## Why This Works for Discovery

**When newsletters + IG curators post events:**
- Venue calendar lists: "Trivia Tuesday at The Hive" (Torrance)
- Newsletter posts: "Tuesday Trivia" (mentions venue is The Hive, Torrance)
- **Dedup:** Fuzzy score 85+ → creates relationship link, doesn't merge
- **Result:** One event shown per location, users can explore other venues
- **Data quality:** No duplicates, clean slate for April push

**When a curator posts a multi-venue event:**
- Curator tip: "Trivia happening Tue at Hive Torrance, Hive Downtown, and Brewgrub"
- **Our system:** Extracts 3 events (one per venue)
- **Fuzzy matching:** Detects they're the same event, creates relationships
- **Display:** User sees one, clicks ⊙ icon, discovers the other two
- **Benefit:** Curator gets credit for all 3, users get full picture

---

## Testing Plan

**Manual test cases:**
1. Ingest same event from two venues (Trivia at Hive Torrance + Hive Downtown)
   - Verify: 2 separate event records created
   - Verify: `event_relationships` table has 1 row linking them
   - Verify: Both events show ⊙ indicator
2. Click indicator, verify related event list appears
3. RSVP to related event, verify it's tracked separately
4. Check map view: both events visible (not merged)

**Edge cases:**
- 3+ venues with same event (chain links or hub & spoke?)
- Same event at same venue, different times (should NOT link)
- Similar titles, different times (should NOT link, score <80)
- One event cancelled, other still live (show both but mark cancelled one as such)

---

## Rollout (Updated Timeline)

**Phase 1 (Week 1–2):** Exact match dedup → keep clean going forward
**Phase 2 (Week 2–3):** Fuzzy match (threshold 80) + create event_relationships
**Phase 3 (Week 3–4):** Frontend UI: ⊙ indicator + related events list
**Phase 4 (Jan):** Curator program launches, visual linking shows value

**Before launch:**
- [ ] New events only (no backfill)
- [ ] Fuzzy threshold: 80
- [ ] Multi-venue linking (don't merge)
- [ ] ⊙ icon, top of card, tappable
- [ ] Related events list on detail page
