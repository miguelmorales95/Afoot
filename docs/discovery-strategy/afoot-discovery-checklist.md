# Afoot Discovery Plan: Quick Start Checklist

## 🎯 Goal
Discover 20–30 new underground LA events per month via newsletters and event-curator partnerships, by **end of February 2027**.

---

## Week 1–2 (This Week + Next Week): Setup & Recon

### Newsletter Discovery
- [ ] Run Gmail scanner on `miguelmorales32395@gmail.com`
  - `npm install googleapis google-auth-library dotenv`
  - `npm run scan:inbox` (private window sign-in, one-time OAuth setup; see INBOX-SCAN.md)
  - Review `newsletters.csv` output
- [ ] Manually identify HIGH-signal newsletters (10–15)
  - Examples: KCRW, LA Taco, Resident Advisor, Unfold, TimeOut LA
  - Check their most recent 3 issues for event keywords
- [ ] Subscribe `afoot-news@somedude.app` to 5 newsletters
  - Start with the highest-signal ones
  - Tag them in `/admin` for tracking

### IG Curator Research
- [ ] Create `@afoot_la` business Instagram account
  - Bio: "Free event search for LA. DM us your underground event tips. No tracking, no login."
  - Link in bio to `afoot.somedude.app`
- [ ] Pick 3 high-signal hashtags from [finding-ig-curators.md](finding-ig-curators.md)
  - Start with `#LAunderground`, `#LAevents`, `#DJsLA`
- [ ] Manually scroll 100 posts total (33 per hashtag)
  - Identify accounts that post events 1–2x/week
  - Save 15–20 account handles to a Google Sheet

---

## Week 3: Pilot Newsletter + Outreach Setup

### Newsletter Testing
- [ ] Extract first 1–2 weeks of events from new newsletters
  - Add to Afoot manually or via extraction pipeline
  - Note: which newsletters have clear event details? Which are ambiguous?
- [ ] Decide: does extraction pipeline need tweaks?
  - If newsletter format is weird, flag it for Claude to handle better
  - If working fine, proceed

### Zapier Setup
- [ ] Create Zapier free account
  - Connect @afoot_la Instagram business account
  - Test a manual DM to yourself (verify IG API is working)
- [ ] Create Google Form: "Curator Outreach Queue"
  - Fields: Instagram Handle, Notes
  - This will be your DM trigger
- [ ] Set up **Zap #1: Send DMs**
  - Trigger: Google Form response
  - Action: Send Instagram DM to curator handle
  - Use message from [ig-automation-zapier.md](ig-automation-zapier.md)
  - **Test:** Fill out form with a test handle, verify DM sends
- [ ] Set up **Zap #2: Monitor Responses**
  - Trigger: New Instagram DM to @afoot_la
  - Filter: Message contains "yes" OR "interested" OR "yeah" OR "cool"
  - Action: Add to Google Sheet (with handle, timestamp, message)
  - Action: Send you an email notification
  - **Test:** Send @afoot_la a test message with "yes"

### Curator Intake Form
- [ ] Create Google Form: "Curator Partner Intake"
  - Questions from [ig-automation-zapier.md](ig-automation-zapier.md), Step 4
  - Save the form link (you'll auto-send this to positive responses)

---

## Week 4: First Outreach Campaign

### Send First Batch
- [ ] Fill out your top 5 curator accounts in the "Curator Outreach Queue" form
  - Zapier automatically sends DMs
  - **Don't send all at once**—stagger over the week (1–2 per day)
- [ ] Track responses in your Google Sheet
  - Note: response time, tone, positive/negative
  - Calculate response rate (goal: 20%+)
- [ ] For positive responses, send intake form link via DM
  - Use Zapier or manual (keep it simple)

### Analyze Results
- [ ] How many responded positively? (target: 1–2 out of 5)
- [ ] What tone resonated? (adjust message if needed)
- [ ] Any patterns in account type? (DJ accounts vs. neighborhood accounts vs. artists?)

---

## Week 5–6: Scale Up

### Newsletter Optimization
- [ ] Add 3–5 more newsletters to `afoot-news@`
  - Test extraction quality
  - If good, keep them; if noisy, unsubscribe

### Curator Outreach: Second Batch
- [ ] Send 10–15 more DMs to curators
  - Adjust message if Week 4 response rate was low
  - Target a mix of vibes (DJs, neighborhood accounts, artists, etc.)
- [ ] Process intake forms from Week 4 responses
  - Approve curators in Afoot admin
  - Send them the welcome email: "You're live! DM us event tips."

### Build Curator Partners List
- [ ] Create in Afoot `/admin`: "Curator Partners"
  - Track: Handle, Joining Date, Event Submissions (this month)
  - Sort by activity

---

## Week 7–8: Optimize & Expand

### Newsletter Fine-Tuning
- [ ] Review which newsletters are adding value
  - Unsubscribe from low-signal ones (too much noise, few events)
  - Consider adding more specialized newsletters (music-specific, art-specific, neighborhood-specific)
- [ ] Check extraction quality (do events match newsletter content?)
  - Flag problematic ones for Claude to improve

### Curator Program Scaling
- [ ] Analyze which curator types are most active
  - DJs submitting more than artists?
  - Neighborhood accounts vs. scene-wide curators?
- [ ] Continue sending 5–10 DMs/week to new curators
- [ ] Monitor curator partnerships for quality + activity
  - Any curators gone quiet? (follow up after 2 weeks of silence)

### Metrics Dashboard
- [ ] Add to `/admin`: simple tracker
  - Events from newsletters: 20–30/month?
  - Events from curators: 10–20/month?
  - Total new events discovered: 30–50/month?

---

## Month 2 (January): Sustained Operation

### Ongoing Work
- [ ] Check newsletter inbox 2x/week
  - Process unmatched emails in `/admin`
  - Approve venue assignments
- [ ] Monitor @afoot_la DMs 2–3x/week
  - Respond to new curator inquiries
  - Process event tips from active curators
  - Review intake forms, approve new partners
- [ ] Monthly curator check-in
  - Which partners are active? Reward them (feature their IG in Afoot)
  - Which are silent? Send a friendly "haven't heard from you" message

### Expansion (If Doing Well)
- [ ] Add 10–20 more newsletters (if getting good signal)
- [ ] Recruit 20–30 active curator partners (if still motivated)
- [ ] Consider: should we automate form-filling? (probably not yet)

---

## Month 3 (February): Measure & Refine

### Results Review
- [ ] How many events discovered from newsletters? (target: 30+ per month)
- [ ] How many from curators? (target: 20+ per month)
- [ ] How many actual RSVPs/users to those events? (secondary metric)
- [ ] Any standout curators or newsletters?

### Decisions
- [ ] Keep doing this? (Probably yes, if 50+ events/month)
- [ ] Double down on curator program? (If getting lots of event submissions)
- [ ] Pivot? (If neither is working, try a different approach)
- [ ] Automate more? (If manual work is becoming a bottleneck)

---

## Effort Estimates

| Task | Time | When |
|---|---|---|
| Gmail scanner setup | 30 min | Week 1 |
| IG curator research | 3–4 hours | Week 1–2 |
| Zapier setup | 2 hours | Week 3 |
| First 5 DMs + tracking | 1 hour | Week 4 |
| Ongoing (DMs, newsletters, intake reviews) | 3–5 hours/week | Weeks 5+ |

**Total first month:** ~15 hours  
**Ongoing (once running):** ~3–5 hours/week

---

## Success Criteria

✅ **Quarter 1 (Feb 28):**
- 15–20 curators recruited
- 10–15 active, submitting events regularly
- 50–80 new events/month from newsletters + curators combined
- Extraction working smoothly (minimal manual cleanup)

✅ **By April (Audience Push Phase):**
- 30+ curator partnerships
- 100+ new underground events/month
- Clear data: which curators/newsletters are highest quality?
- Ready to show sponsors: "Here's where these events come from"

---

## Files Reference

- **Main Strategy:** [afoot-discovery-strategy.md](afoot-discovery-strategy.md)
- **Newsletter Scanner:** [INBOX-SCAN.md](INBOX-SCAN.md)
- **IG Automation:** [ig-automation-zapier.md](ig-automation-zapier.md)
- **Finding Curators:** [finding-ig-curators.md](finding-ig-curators.md)
- **This Checklist:** [afoot-discovery-checklist.md](afoot-discovery-checklist.md)

---

## Notes

- **Incognito browser:** Only needed for first Gmail auth. After that, the script runs headless.
- **Don't spam:** Max 5–10 DMs/week to curators. Quality > quantity.
- **Humanness matters:** The message works because it's genuine. Don't over-optimize it.
- **Flexibility:** If a newsletter is dud or curator goes silent, move on. No sunken cost fallacy.
- **Timeline:** You have until end of April to show results for the audience push. This plan gets you there by February with time to refine before launch.
