# Afoot Discovery Strategy: Newsletters + IG Curators
**Updated:** 2026-11-23 | **Owner:** Miguel Morales

---

## Part 1: Newsletter Discovery from Gmail

### 1A. Scanning miguelmorales32395@gmail.com

**Setup:** Gmail API + Node script that runs locally (no server)

The script will:
1. Authenticate via OAuth (browser-based, one-time setup)
2. Scan inbox for newsletters (filter by common newsletter domains: Substack, Revue, etc., or manual labels)
3. Extract sender email, subject, and date ranges
4. Rate them: does the subject mention events? (keywords: "event", "happening", "night", "this week", etc.)
5. Output a CSV of candidate newsletters with signal score

**Incognito browser setup:**
- Run the script in an incognito session so it doesn't mess with your normal login
- Use `google-auth-library` to handle OAuth flow (opens browser, you click "allow", token saved locally in `.env`)
- After setup, the script can run any time—no manual login needed

**What to export:**
- Newsletter sender + domain
- Subject line patterns
- Frequency (weekly, biweekly, etc.)
- Last 5 issues (dates + subject line)
- Manual signal rating: **High** (definitely event-related), **Medium** (sometimes events), **Low** (maybe useful, review)

**Example output:**
```
sender,domain,frequency,signal,last_issue_date,subject_pattern
kcrw-events@kcrw.com,kcrw.com,weekly,HIGH,2026-11-23,"KCRW Events: This Week"
info@lataco.com,substack.com,weekly,MEDIUM,2026-11-22,"LA Taco Dispatch"
music@resident-advisor.com,ra.com,weekly,HIGH,2026-11-21,"RA: LA This Week"
```

### 1B. Extend with Family Emails (Optional)

If family members (or friends) are "much more part of the club and social scene," you could:
- Ask them to give you read-only access to their Gmail (via OAuth)
- Same scan on their inbox
- Dedup and merge results
- Weight their newsletters higher (more signal from active people)

**Keep it simple:** one additional email max at first. You can test with one family member's inbox, see if it surfaces new newsletters you're missing.

### 1C. Processing the Newsletter List

Once you have 10–15 high-signal newsletters:
1. **Subscribe Afoot's email** (`afoot-news@somedude.app`) to each one
2. **Tag them in `/admin`** so unmatched emails are easier to review
3. **Route to extraction:** existing pipeline already handles this

**Don't over-automate at first.** Even if 50% of newsletters are noise, 5–10 high-signal ones give you constant event flow.

---

## Part 2: IG Account Strategy & Automation

### 2A. The Message (Humanness-First)

**Subject:** DM on IG (don't email, stay native to their platform)

```
hey! love what you're posting about LA events. i run afoot.somedude.app—
basically a small free site where people search for events near them. 
no tracking, no login needed.

we're trying to surface the underground/smaller events that never make it 
onto ticketmaster. if you wanted to send us a heads up when you post 
something (just a link, name, date), we'd add it to the feed and credit 
your account. your followers could find you that way, and we'd actually 
know what events people are looking for.

no payment, no contract—just helping each other out. interested?
```

**Why this works:**
- Short, conversational (not corporate)
- Explains what Afoot *is* (not an ad platform)
- Clear ask (send event info, get credit)
- No money talk upfront (removes friction)
- Signals you're small + local ("some dude", founder-led)

---

### 2B. Finding IG Accounts (Hashtag + Consistency Strategy)

**Don't spray-and-pray. Find accounts that:**
1. Post events at least 1–2x per week
2. Have 2k–50k followers (engaged community, not mega-influencers, not spammy)
3. Have been active for 6+ months (shows they're committed, not a one-off)
4. Post original takes (curated event recommendations, not just reposting venue stories)

**Discovery method:**

**Step 1: Seed hashtags** (run these searches manually or via script)
- `#LAevents` — obvious, lots of noise, but some curators
- `#LAunderground` — smaller venues, DIY events
- `#LAnightlife` — clubs, parties, music
- `#DJsLA` — music-specific
- `#LAartscene` — galleries, pop-ups, artist events
- `#LatinxLA` / `#SoCalmusic` / similar niche hashtags
- Neighborhood-specific: `#HighlandParkEvents` `#EchoParkLA` `#TorranceCA` etc.

**Step 2: Identify curators vs. noise**
Look for accounts that:
- Write captions (not just repost venue stories)
- Mention event *dates/times* (not vague hype)
- Link to events or Afoot would link to them
- Show up consistently in hashtag results

**Step 3: Quality check**
Manually scroll 15–20 recent posts. Skip if:
- 90% reposting venue content (not adding value)
- Posting once a month (not reliable)
- Looks like bot activity (generic comments, sudden follow sprees)

**Output:** A list of 20–30 candidate accounts, categorized by vibe:
- Music/nightlife curators
- Neighborhood-specific
- Art/culture/galleries
- Multi-category (best signal)

---

### 2C. Automation Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Step 1: Business IG Account Setup                       │
│ Create @afoot_la (or similar)                           │
│ Bio: "Free event search for LA. DM us your underground  │
│       event tips. No tracking, no login."               │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Targeted Outreach (Semi-Automated)             │
│                                                         │
│ You manually: select 3–5 accounts per day from your    │
│ candidate list (or build a simple UI to queue them)    │
│                                                         │
│ Script: Send DM via Instagram API (meta-ig library)    │
│         or Zapier/Make.com (no-code, safer)            │
│                                                         │
│ Log: account, message sent, date, timestamp            │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: Monitor Responses                              │
│                                                         │
│ Script: Poll @afoot_la DMs every 2 hours               │
│ Look for: "yes", "interested", "yeah", "cool", etc.    │
│           (simple keyword matching)                     │
│                                                         │
│ When match found:                                       │
│ 1. Notify YOU in Afoot admin dashboard                 │
│    "New curator: @username wants to join"             │
│ 2. Auto-send them a form link (Google Form or Afoot   │
│    custom form) with:                                  │
│    - What events do you usually post about?           │
│    - How often?                                        │
│    - Best way to send us tips (DM, email, form)?      │
│    - Can we credit you as @username?                  │
│ 3. Store response in Afoot DB                         │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: Curator Onboarding                             │
│                                                         │
│ You review their form response (Afoot admin).          │
│ Approve → they're added to "Curator Partners" list    │
│ → their account gets credited in Afoot when you post  │
│   an event they tipped you on                          │
│                                                         │
│ They get a one-line email:                            │
│ "You're live on Afoot! When you find an event,       │
│  just DM @afoot_la and we'll add it + credit you."   │
└─────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5: Ongoing Event Intake                           │
│                                                         │
│ Curator DMs event link (or manually types: date, name, │
│ venue, link)                                            │
│                                                         │
│ Script: Extract event from link (Afoot's existing     │
│        link-reader) or curator-submitted form          │
│        → goes to Afoot admin as "Curator Tip"         │
│                                                         │
│ You: Review in /admin, approve → posts live with      │
│      credit: "Discovered by @username"                │
└─────────────────────────────────────────────────────────┘
```

**Why this works:**
- **You control the flow:** You pick 3–5 accounts a day (not spray-and-pray)
- **Curators self-select:** Only people interested respond
- **Automated fallback:** If they go silent, no effort wasted
- **Built-in quality filter:** Manual review before posting
- **Growth signal:** Their followers see the credit → follow @afoot_la → become users

---

### 2D. Implementation: Tools

**IG API access:**
- Meta Instagram Graph API (requires business account + app approval—3–7 days)
  - Can send DMs, read DMs, track sent/read status
  - Official but slow to approve
  
- **Zapier/Make.com (easier for now):**
  - Zapier: "Send Instagram DM to multiple people" (exists)
  - Then: "If email from [curator] contains 'yes'", create Afoot admin notification
  - No code, 5-minute setup
  - Cost: ~$30–50/month if you're sending lots of DMs, but cheap for 5 accounts a day

**IG DM Monitoring:**
- **Option A (easiest):** You manually check @afoot_la DMs daily (takes 5 min)
- **Option B (semi-auto):** Zapier → "If new DM to @afoot_la" → webhook to Afoot admin → notify you
- **Option C (full auto):** Node script using `instagram-private-api` (more fragile, Instagram doesn't officially support it)

**Recommendation:** Start with **Zapier** (no code, official, reliable) for the first month, then build internal if the volume is high.

---

### 2E. Scaling Signals (How to Know It's Working)

Track these in your Afoot admin dashboard:
- **Curators recruited:** # of approved partners over time
- **Events from curators:** # of events submitted per curator per month
- **Credit attribution:** When you post "Discovered by @username", do they get followers? (IG link analytics)
- **Repeat submitters:** Which curators are sending 2+ events/month? (high-signal partners)

If 10 curators send you 2–3 events/month each, that's 20–30 *new* events you wouldn't have otherwise. If 20% convert to RSVPs, that's 4–6 new users/month finding events this way.

---

## Part 3: The 90-Day Roadmap

### Month 1 (November–December): Discovery + Outreach
- [ ] Set up Gmail API script, scan your inbox → 15 high-signal newsletters
- [ ] Subscribe `afoot-news@` to 5 of them, test extraction
- [ ] Manually identify 30 candidate IG accounts via hashtags
- [ ] Create @afoot_la business account
- [ ] Send 10–15 DMs (5 per week) to curators
- [ ] Goal: 2–3 responses, 1–2 approved partners

### Month 2 (January): Beta Program
- [ ] 5–10 active curator partners
- [ ] Set up form intake + Afoot admin notifications
- [ ] Process 20–30 curator-submitted events
- [ ] Fine-tune the message based on responses
- [ ] Add 5–10 more curators based on what's working

### Month 3 (February): Refine + Automate
- [ ] Scale to 20–30 curator partners
- [ ] Build Zapier / automation for DM monitoring
- [ ] Extract insights: which neighborhoods/vibes are curators finding?
- [ ] Iterate message if response rate drops

---

## Part 4: Why This Approach Works (and Doesn't)

✅ **Why this works:**
- Aligns with Afoot's core idea (small events that don't appear elsewhere)
- Curators are intrinsically motivated (they already do this, you just give them credit)
- Builds community (they become partners, not just suppliers)
- Self-limiting spam (manual selection of curators, not 1,000 DMs a day)
- Repeatable (once you find one curator, you can replicate the vibe)

❌ **Limitations:**
- Slow to scale (manual review keeps quality high, but it's work)
- Relies on curator engagement (some will ghost after 1–2 events)
- IG API approval takes 1–2 weeks (use Zapier to skip that pain)
- Not all events are on IG (you'll miss physical flyers, word-of-mouth only, old-school venues)

---

## Next Steps

1. **This week:**
   - [ ] Set up Gmail API script (outline below)
   - [ ] Create @afoot_la IG account
   - [ ] Manually audit 30 IG accounts via hashtags

2. **Next week:**
   - [ ] Run newsletter scan, identify top 10
   - [ ] Subscribe to 5, test extraction
   - [ ] Send first batch of 5 IG DMs (manually or via Zapier)

3. **Rest of November:**
   - [ ] Keep sending 3–5 DMs/week to curators
   - [ ] Process incoming events from newsletters
   - [ ] Refine the message based on early responses
