# Afoot Deduplication: Simplified Implementation Checklist

**Decisions Locked In:**
- ✅ Fuzzy threshold: 80 (not 65–85 range)
- ✅ No backfill (clean going forward)
- ✅ Multi-venue: Keep separate, link with ⊙ icon
- ✅ No merge logic needed (simplifies code)

**Effort:** ~15–20 hours total
**Timeline:** Complete by Dec 20 (before curator launch)

---

## Phase 1: Exact Match Dedup (Week 1) ✅ SAFE

### Code Changes
- [ ] In `lib/ingest.ts`, add normalization functions:
  ```typescript
  function normalizeEventTitle(s: string): string
  function normalizeVenueName(s: string): string
  function normalizeTime(isoString: string): { date: string; hour: number }
  ```
- [ ] Before `storeExtractedEvents()`, check for existing occurrence:
  ```typescript
  // Check: same venue + same date + same hour
  const existing = await supabase
    .from('event_occurrences')
    .select('event_id, starts_at')
    .eq('event_id:events.venue_id', venueId)
    .eq('DATE(starts_at AT TIME ZONE...)', dateStr)
    .eq('EXTRACT(HOUR FROM starts_at...)', hourNum);
  ```
- [ ] If found: skip insertion (this occurrence already exists)
- [ ] Log: `"Skipped: 'Event Title' (already listed for Venue at that time)"`

### Database
- [ ] No schema changes needed yet

### Test
- [ ] Run ingest on same venue twice → should skip 2nd time
- [ ] Manually check: no duplicate occurrences in DB

### Deploy
- [ ] Simple, low-risk change
- [ ] Should see skip messages in ingest logs

**Estimated time:** 2–3 hours

---

## Phase 2: Fuzzy Match Dedup + Linking (Week 1–2) ⚠️ Core Feature

### Schema
- [ ] Add migration:
  ```sql
  CREATE TABLE IF NOT EXISTS event_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id_1 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    event_id_2 UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    relationship_type TEXT DEFAULT 'multi_venue',
    confidence NUMERIC,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id_1, event_id_2)
  );
  ```

### Code
- [ ] Implement `fuzzyScore()` function:
  ```typescript
  function fuzzyScore(title1: string, title2: string, time1: number, time2: number): number {
    // Returns 0-100
    // Check word overlap (titles should share 70%+ words)
    // Check time proximity (should be within 2 hours)
    // If both conditions met and score ≥80, it's a match
  }
  ```
- [ ] In `dedupExtractedEvents()`:
  ```typescript
  for (const event of events) {
    // 1. Check exact match first (Phase 1 logic)
    // 2. If no exact match, check for fuzzy match in same venue
    const existing = await findEventsInVenue(venueId);
    const fuzzy = existing.map(e => ({
      ...e,
      score: fuzzyScore(event.title, e.title, event.time, e.time)
    })).filter(e => e.score >= 80);
    
    if (fuzzy.length > 0) {
      // Create relationship, DON'T create new event
      await supabase.from('event_relationships').insert({
        event_id_1: fuzzy[0].id,
        event_id_2: null,  // Will be populated after event creation
        relationship_type: 'multi_venue',
        confidence: fuzzy[0].score
      });
      log(`~ "${event.title}" linked to existing event (score: ${fuzzy[0].score}%)`);
      continue;  // Skip insertion
    }
    
    // Not a duplicate, insert normally
    // (existing storeExtractedEvents logic)
  }
  ```

### Test
- [ ] Test case 1: "Trivia Night" vs "Tuesday Trivia" (same venue, same hour) → should link
- [ ] Test case 2: "Trivia 7pm" vs "Trivia 8:30pm" (same venue, 1.5h apart) → should NOT link (score <80)
- [ ] Test case 3: "Karaoke" vs "Live Music" → should NOT link
- [ ] Check `event_relationships` table: contains the link
- [ ] Check events table: NO new event created (the fuzzy match was rejected)

### Deploy
- [ ] Monitor logs for fuzzy match messages
- [ ] Spot-check: a few linked events should appear in `/admin`
- [ ] Watch for false positives (did we accidentally link different events?)

**Estimated time:** 4–6 hours

---

## Phase 3: Frontend UI – ⊙ Indicator + Related List (Week 2–3) 🎨

### Schema
- [ ] New RPC function:
  ```sql
  CREATE OR REPLACE FUNCTION related_events(event_id UUID)
  RETURNS TABLE (...) AS $$
    -- Query event_relationships, return linked events
  $$ LANGUAGE SQL;
  ```

### Frontend Components
- [ ] Create `EventLinkedIndicator.tsx`:
  - Query `related_events()` RPC
  - Show "⊙ X other locations" if exists
  - Tappable, calls `onClick` callback
  
- [ ] Create `RelatedEventsList.tsx`:
  - Shows related events in a list/collapse
  - Each shows: venue name, date, time, [View] button
  - Styled to match existing event cards

### Display Locations
- [ ] Event Card (List view):
  - Show ⊙ indicator above title
  - On click: expand/collapse related list below card
  
- [ ] Event Detail Page:
  - Show ⊙ indicator at top (before title)
  - Expandable section below main event info
  - Each related event: clickable link to its detail page

### Styling
- [ ] Icon: ⊙ or 🔗, accent color, 16–18px
- [ ] Label: "X other locations" or "Related events"
- [ ] Hover: cursor pointer, subtle opacity change
- [ ] Related list: indented, smaller cards or simple list items

### Test
- [ ] Link two events manually in DB
- [ ] Load event detail page, verify ⊙ shows
- [ ] Click ⊙, verify related list appears
- [ ] Click related event, navigate to its detail page
- [ ] Check map view: both events visible (not hidden/merged)
- [ ] Check mobile: indicator still visible, list readable

**Estimated time:** 5–7 hours

---

## Phase 4: Curator Source Credits (Week 3–4) 📌 Needed for Partnerships

### Schema (if not already done)
- [ ] `ALTER TABLE events ADD COLUMN sources_json JSONB DEFAULT '[]'`
  - Each source: `{ source: 'curator', source_id: '@username', url: '...', credited_to: '@username' }`

### Code
- [ ] In `dedupExtractedEvents()`, when fuzzy match found:
  ```typescript
  // Don't create new event, but add source to existing
  const existingEvent = await supabase.from('events').select('sources_json').eq('id', fuzzyMatch.eventId).single();
  const sources = existingEvent.sources_json ?? [];
  
  // Check: source already in list?
  if (!sources.some(s => s.source === 'curator' && s.source_id === cuatorHandle)) {
    sources.push({ source: 'curator', source_id: curatorHandle, url: curatorLink, credited_to: curatorHandle });
    await supabase.from('events').update({ sources_json: sources }).eq('id', fuzzyMatch.eventId);
  }
  ```

### Frontend Display
- [ ] In event detail, add "Sources" section:
  ```
  Sources:
  🏢 Listed by Venue
  📱 Posted by @dj_maya
  ```
- [ ] "Discovered by" in card: "🔗 Discovered by @dj_maya" (clickable)

### Test
- [ ] Manually simulate curator tip for existing event
- [ ] Verify new source added to `sources_json`
- [ ] Verify no new event created
- [ ] Verify frontend shows curator credit
- [ ] Click curator link, goes to their IG profile

**Estimated time:** 2–3 hours

---

## Quick Test Script

```bash
# Test exact match (Phase 1)
npm run ingest -- --dry-run venue-slug
npm run ingest -- venue-slug
npm run ingest -- venue-slug  # 2nd time, should skip some

# Test fuzzy match (Phase 2)
# Manually edit a CSV or JSON to have same event with slightly different title
npm run ingest -- --dry-run --file test-fuzzy.csv

# Check DB
psql $DATABASE_URL -c "SELECT title, COUNT(*) FROM events GROUP BY title HAVING COUNT(*) > 1;"
# Should show minimal duplicates (only intentional multi-venue ones)
```

---

## Rollout Checklist

- [ ] **Phase 1:** Exact match (safe)
  - [ ] Code written + tested locally
  - [ ] Merge to main
  - [ ] Deploy to Vercel
  - [ ] Monitor for 24h, check ingest logs

- [ ] **Phase 2:** Fuzzy match (core feature)
  - [ ] Code written + test cases pass
  - [ ] Schema migration applied
  - [ ] Merge to main
  - [ ] Deploy to Vercel
  - [ ] Monitor for false positives

- [ ] **Phase 3:** Frontend UI
  - [ ] Components built + tested locally
  - [ ] RPC function created
  - [ ] Merge to main
  - [ ] Deploy to Vercel
  - [ ] Test on live site (check a linked event)

- [ ] **Phase 4:** Curator credits
  - [ ] Schema + code (if not done)
  - [ ] Frontend display
  - [ ] Test end-to-end (curator post → event created → credit shown)

---

## Blockers / Decisions

None! All decisions locked in. Just code and ship.

**Red flags (if you see these, pause and investigate):**
- Fuzzy match score <60 for similar titles → threshold too low, increase to 85+
- Fuzzy match score >90 for different events (Trivia vs. Music) → scoring is broken
- Event with RSVP gets linked/unlinked → data integrity issue, needs fix
- Linked events showing up as separate on Map → frontend not filtering correctly

---

## Timeline

| Week | Phase | Hours | Status |
|---|---|---|---|
| 1 | Phase 1 (Exact match) | 2–3h | Do first, low risk |
| 1–2 | Phase 2 (Fuzzy + linking) | 4–6h | Core feature |
| 2–3 | Phase 3 (Frontend UI) | 5–7h | Polishing |
| 3–4 | Phase 4 (Curator credits) | 2–3h | Last piece |
| **Total** | | **13–19h** | **Done by Dec 20** |

---

## Success Criteria

✅ **Phase 1 done:**
- Exact duplicate occurrences no longer appear
- Ingest logs show skipped duplicates

✅ **Phase 2 done:**
- Multi-venue events are linked (not merged)
- Fuzzy score of 80+ correctly identifies same events
- No false positives (different events accidentally linked)

✅ **Phase 3 done:**
- ⊙ icon visible on event cards
- Clicking shows related events
- Related events link to each other

✅ **Phase 4 done:**
- Curator sources tracked and displayed
- No duplicate attribution

✅ **Ready for newsletter + curator launch:**
- 50+ new events/month → 0 duplicates
- Users see variety, trust the app
- Sponsors see clean data
