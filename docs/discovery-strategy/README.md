# Afoot Discovery Strategy: Newsletters + IG Curators + Deduplication

**Date:** 2026-11-23 | **Owner:** Miguel Morales

This folder contains the complete strategy for discovering 50–80 new underground LA events per month through newsletters and Instagram curator partnerships, with strict deduplication built in.

---

## Files Overview

### 📋 Start Here
- **[afoot-discovery-checklist.md](afoot-discovery-checklist.md)** — Week-by-week checklist (Nov 2026 → Feb 2027). Best overview of the full flow.

### 🔍 Deep Dives

#### Part 1: Newsletter Discovery
- **[afoot-discovery-strategy.md](afoot-discovery-strategy.md)** — Full section on scanning Gmail, finding newsletters, extraction pipeline. Scanner: `npm run scan:inbox` (see INBOX-SCAN.md).
- **[dedup-research-and-learnings.md](dedup-research-and-learnings.md)** — How we decide two listings are the same event: what others do, what we tried, what broke, the current rule.
- **[INBOX-SCAN.md](INBOX-SCAN.md)** — `npm run scan:inbox`: sign in to any Google account, get a list of venues/sources to track (setup + how to read results).

#### Part 2: IG Curator Partnerships
- **[afoot-discovery-strategy.md](afoot-discovery-strategy.md)** — Full section on finding curator accounts, humanized pitch, Zapier automation.
- **[finding-ig-curators.md](finding-ig-curators.md)** — Tactical guide: hashtags to search, quality checks, curator discovery methods.
- **[ig-automation-zapier.md](ig-automation-zapier.md)** — Step-by-step Zapier setup (DM sending, response monitoring, intake forms). No-code, 5-minute setup.

#### Part 3: Deduplication (Critical)
- **[afoot-dedup-decisions.md](afoot-dedup-decisions.md)** — UI design spec: ⊙ icon, schema changes, code examples. Also covers fuzzy threshold (80) and multi-venue linking.
- **[dedup-simplified-checklist.md](dedup-simplified-checklist.md)** — Week-by-week implementation (Phases 1–4, 15–20 hours total). Most actionable.
- **[afoot-deduplication-strategy.md](afoot-deduplication-strategy.md)** — Original comprehensive 6-layer strategy (reference).

---

## Quick Start

**This week (Nov 24–30):**
1. Read [afoot-discovery-checklist.md](afoot-discovery-checklist.md) (get the full picture)
2. Read [afoot-dedup-decisions.md](afoot-dedup-decisions.md) (understand the ⊙ icon design)
3. Run `npm run scan:inbox` on each Gmail account → see what places and newsletters to track

**Next 2 weeks (Dec 1–15):**
1. Implement dedup Phase 1–2 (exact + fuzzy match, threshold 80)
2. Set up Zapier for IG DM automation
3. Send first 5 curator DMs
4. Subscribe `afoot-news@somedude.app` to 5 high-signal newsletters

**By Dec 20:**
- Dedup Phases 3–4 complete (UI + curator credits)
- Ready for newsletter + curator launch

---

## Key Decisions (Locked In)

✅ **Fuzzy threshold: 80** (simple: confident duplicate or keep separate)  
✅ **No backfill** (clean going forward only)  
✅ **Multi-venue: Keep separate + link with ⊙ icon** (users discover alternatives)  
✅ **Humanness angle** (small LA company pitch, not corporate)

---

## Timeline Summary

| Milestone | Target | Effort |
|---|---|---|
| Newsletter scanning + IG curator research | Dec 1 | Week 1–2 (3 hrs) |
| Zapier setup + dedup Phase 1–2 | Dec 8 | Week 2–3 (8 hrs) |
| First 5 curator DMs sent | Dec 10 | Week 3 (2 hrs) |
| Dedup Phase 3 (UI) + Phase 4 (credits) | Dec 20 | Week 4 (10 hrs) |
| 5 newsletters subscribed + flowing | Dec 15 | Week 2–3 (2 hrs) |
| **50–80 new events/month, zero duplicates** | **Feb 28** | **Ongoing** |

---

## Related Files in Afoot

- Existing newsletter pipeline: `lib/newsletter.ts`
- Event extraction: `lib/extract.ts`
- Ingestion: `lib/ingest.ts`
- Admin UI: `app/admin/page.tsx`

---

## Questions?

Refer to the specific markdown file for your question:
- **"How do I find curators?"** → [finding-ig-curators.md](finding-ig-curators.md)
- **"How do I set up Zapier?"** → [ig-automation-zapier.md](ig-automation-zapier.md)
- **"How does dedup work?"** → [afoot-dedup-decisions.md](afoot-dedup-decisions.md)
- **"What's the week-by-week plan?"** → [afoot-discovery-checklist.md](afoot-discovery-checklist.md)
