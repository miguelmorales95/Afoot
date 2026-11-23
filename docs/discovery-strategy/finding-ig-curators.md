# Finding IG Curator Accounts: Tactical Guide

**Goal:** Identify 30–50 high-quality event-posting accounts in LA that are:
- Posting events 1–2x per week consistently
- 2k–50k followers (engaged, not mega-influencers)
- 6+ months of activity (shows commitment)
- Adding original insight (not just reposting)

---

## Phase 1: Seed Hashtag Research (Automated Scraping)

**Don't use Instagram's native search at first—it's noisy.** Use a free tool to get baseline accounts.

### Tools to Use:

**Option A: TagsForLikes.com (free)**
1. Go to tagsfollikes.com/explorer
2. Enter hashtag (e.g., `#LAevents`)
3. See: top posts, posting frequency, related hashtags
4. Take notes on which accounts appear in top results (they're consistent posters)

**Option B: Instagrm.com (free)**
1. Enter hashtag → shows top accounts using it
2. Filter by follower count (2k–50k range)
3. Click each account to check posting frequency (is it 1–2x/week?)

**Option C: Script It Yourself (Python)**
```python
# Using instagrapi (unofficial but works)
from instagrapi import Client

client = Client()
# client.login("your_ig_account", "password")  # optional, but helps avoid rate limit

hashtags = ['LAevents', 'LAunderground', 'LAnightlife', 'DJsLA']
curators = set()

for tag in hashtags:
    posts = client.hashtag_medias_recent(tag, amount=50)  # last 50 posts
    for post in posts:
        curators.add({
            'account': post.user.username,
            'followers': post.user.follower_count,
            'engagement': post.like_count + post.comment_count
        })

# Export to CSV
import csv
with open('ig_curators.csv', 'w') as f:
    writer = csv.DictWriter(f, fieldnames=['account', 'followers', 'engagement'])
    writer.writerows(curators)
```

---

## Phase 2: Hashtag Categories to Scan

Pick 5–10 hashtags from each category, mix and match:

### **High-Signal (Specific, event-focused)**
- `#LAevents` — most direct, lots of venues + curators
- `#LAunderground` — underground/DIY, exactly what Afoot wants
- `#DJsLA` — DJ scene, club culture, music events
- `#LAartscene` — galleries, pop-ups, artist events
- `#LatinxLA` — Latino-focused events (huge scene in LA)
- `#SoCalmusic` — broader Southern CA music scene

### **Neighborhood-Specific (Build a list of 20–30)**
- `#HighlandParkLA` / `#EchoParkLA` / `#SilverLakeLA` / `#LosFelesLA` — hipster/arts scenes
- `#DowntownLA` / `#DTLA` — downtown scene
- `#TorranceCA` / `#SouthBayLA` — South Bay
- `#LongBeachCA` — LB scene
- `#PasadenaCA` — Pasadena events
- `#WehoLA` — West Hollywood nightlife

### **Medium-Signal (Broader, some noise)**
- `#LAnightlife` — clubs, bars, parties
- `#LAmusic` — music-focused
- `#LAconcerts` — concert announcements
- `#LAlivemusic` — live music specifically
- `#DanceLA` — electronic/dance scene
- `#LAcomedy` — stand-up, improv events
- `#ArtsLA` — visual arts + culture

### **Lower-Signal (Use for inspiration, not outreach)**
- `#LosAngeles` — too broad, mostly tourism
- `#WeekendPlans` — not LA-specific
- `#FYP` — not relevant

---

## Phase 3: Manual Quality Check (Do This First)

Pick **one high-signal hashtag** and manually scroll 50–100 posts. Look for accounts that:

✅ **High Signal:**
- Write a caption (not just reposting venue story)
- Mention *dates* or *times* (e.g., "Friday 10pm at...", "Nov 23 @...")
- Link to events or describe what's happening
- Use emoji/formatting (shows care in curation)
- Post consistently (at least 1–2 per week)
- Engaged comments (not 2 likes from bots)

❌ **Low Signal / Skip:**
- Pure repost (just the venue's story with emoji)
- One post a month (not reliable)
- Looks like bot activity (generic comments, sudden follow sprees)
- 50k+ followers but no original voice (megainfluencer, different mission)

**Example of high-signal post:**
```
@username: 
"back to the warehouse vibes 🔥 this saturday midnight 
hiphop + house all night, $10 at the door. tagging @dj_maya 
who's opening. link in bio if you want pre-sale discount codes"

[attached: venue location screenshot]
[90 likes, 15 comments from people asking "which warehouse?"]
```

**Example of low-signal post:**
```
@venue_official:
[venue story repost]
[2 likes]
```

---

## Phase 4: Build Your Master Curator List

Create a Google Sheet with these columns:

| IG Handle | Followers | Posting Frequency | Vibe | Contact Status | Last Post Date | Notes |
|---|---|---|---|---|---|---|
| @dj_maya | 3.2k | 2x/week | House/Electronic | To Contact | Nov 22 | Hosts warehouse events, good reach in underground scene |
| @highland_park_nights | 5.1k | 1x/week | Mixed/Neighborhood | To Contact | Nov 21 | Strong neighborhood focus, real community |
| @la_latin_beats | 8.4k | 1x/week | Latin/Music | To Contact | Nov 20 | High engagement, bilingual audience |

**How to find the data:**
- **Handle & Followers:** Click the account
- **Posting Frequency:** Scroll their last 20 posts, count how many in the last 30 days
- **Vibe:** Read their bio + 5–10 captions
- **Last Post Date:** Check their most recent post
- **Notes:** Why they're relevant (what makes them a good fit)

---

## Phase 5: Prioritize for Outreach

**First batch (5–10 accounts):** High-quality, clearly aligned with Afoot
- 2k–10k followers (sweet spot: engaged community)
- Posting 1–2x per week consistently
- Clear original voice (not just reposting)
- Vibe matches Afoot (underground, small venues, diverse)

**Second batch (10–20 accounts):** Good fit, slightly less certain
- 10k–30k followers (larger reach, maybe less boutique)
- 1x per week posting (a bit slower, but okay)
- Mix of original posts + reposts

**Third batch (20+):** Opportunistic (if first two batches work)
- Neighborhood-specific accounts (high local value)
- Niche community accounts (art, music subgenres, etc.)

**Don't reach out to yet:**
- 50k+ followers (different business model, likely want payment)
- Posting <1x per month (low reliability)
- Accounts that look abandoned (no post in 2 months)

---

## Phase 6: Outreach Schedule

**Week 1:** Send 5 DMs (1 per day, or batch on weekends)
- Track which ones respond
- Note response time + tone

**Week 2:** Based on Week 1 results:
- If getting 50%+ positive responses → scale to 10 DMs/week
- If getting 10–20% → tweak message, try different vibe accounts
- If <10% → pause, review which accounts you're picking

**Weeks 3–4:** Keep steady pace (5–10/week), monitor for fatigue or quality drop in responses

**Example tracking sheet:**
| Date Sent | IG Handle | Followers | Vibe | Message Sent | Response | Positive? | Form Sent | Approved |
|---|---|---|---|---|---|---|---|---|
| Nov 23 | @dj_maya | 3.2k | Electronic | Yes | "yeah i'm down" | ✅ | Nov 23 | Pending |
| Nov 23 | @highland_park_nights | 5.1k | Mixed | Yes | (no response) | ❌ | -- | -- |

---

## Phase 7: Hashtag Monitoring (Ongoing)

Once you have 10–20 curators live, monitor the hashtags they use to find *similar* accounts:

1. When a curator posts an event, see what hashtags they use
2. If they use `#LAunderground`, scan that hashtag for other curators
3. Add any new high-signal accounts to your list

This is a slow organic growth mechanism—not spray-and-pray.

---

## Pro Tips

### **Avoid These Mistakes:**
- ❌ Reaching out to 100 accounts at once (looks spammy, kills response rate)
- ❌ Targeting only mega-accounts (they want payment, different scale)
- ❌ Ignoring timezone/timing (send DMs during LA evening hours, 6–9pm PT)
- ❌ Not checking if they're already in Afoot's venue database (might be competing, or might not care)

### **High-Signal Indicators:**
- ✅ Bilingual captions (Spanish + English = engaged LA community)
- ✅ Linking to multiple small venues (not just their own events)
- ✅ Mentioning artists/DJs by name (shows community knowledge)
- ✅ Asking followers questions in captions (engaged audience)
- ✅ Tagged locations (geography-aware)

### **Finding Hidden Gems:**
- **Follow a known good account**, then look at their follower list
- **Check the "followers also follow" section** (IG shows similar accounts)
- **Look at replies on big LA event posts** — people commenting are usually into events
- **Monitor Eventbrite/Ticketmaster event pages** for who's tagging related IG accounts

---

## Expected Results

**After contacting 30 accounts:**
- Response rate: 20–40% (some will ghost, some will respond negatively)
- Positive responses: 10–15 (true interest)
- Approved curators: 5–10 (after they fill out the form)
- **Active submitting events within 1 month: 2–5**

This is not a failure—it's healthy. Those 2–5 curators will give you 10–20 events/month, which is gold for underground LA events.

---

## Next Steps

1. **This week:**
   - [ ] Pick 1 high-signal hashtag
   - [ ] Manually scroll 100 posts, note 5–10 accounts that feel right
   - [ ] Add them to your master Google Sheet

2. **Next week:**
   - [ ] Expand to 3–5 hashtags
   - [ ] Build a list of 20–30 curators
   - [ ] Prioritize first 10 for outreach

3. **Rest of November:**
   - [ ] Send first 5 DMs
   - [ ] Adjust message based on responses
   - [ ] Keep building the list in background

4. **December:**
   - [ ] Scale to 10–15 DMs/week if going well
   - [ ] Process form responses, approve curators
   - [ ] Start accepting event tips
