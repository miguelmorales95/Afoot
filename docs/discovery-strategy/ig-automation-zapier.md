# IG Curator Outreach: Zapier Automation Guide

## Why Zapier (not building custom)?
- **No code:** 5-minute setup
- **Official:** IG API is reliable through Zapier
- **Cheap:** ~$30/month for DM sending + monitoring
- **Built-in fallbacks:** If a DM fails, it logs it; you can retry

---

## Setup Overview

```
You manually select curators
         ↓
Zapier: Send DM to curator @account
         ↓
Curator responds with "yes" / "interested" / etc.
         ↓
Zapier: Catch new DM to @afoot_la, extract keywords
         ↓
Zapier: If positive response detected, create Google Sheet row
         ↓
Zapier: Webhook to Afoot admin dashboard (notify you)
         ↓
Zapier: Auto-send curator a Google Form link to fill out
         ↓
You review response in Afoot admin, approve/reject
```

---

## Step 1: Create Zapier Account & Connect Instagram

1. Go to **zapier.com**, create a free account
2. Click **Create Zap**
3. **Trigger:** Search for "Instagram" → Select **New Instagram Direct Message** (requires business account)
4. Connect your @afoot_la Instagram business account (Zapier will walk you through OAuth)
5. Test the connection (send yourself a DM to verify)

---

## Step 2: Zap #1 — Send DM to Curators (Semi-Manual)

**Trigger:** You manually trigger this via Zapier's "Webhook by Zapier" or a Google Form

**Option A (Easier): Use a Google Form**
1. Create a Google Form: "Curator Outreach Queue"
   - Field: Instagram Handle (required)
   - Field: Notes (optional)
2. Each time you want to DM someone, fill out the form
3. Zapier watches the form responses → sends DM automatically

**Setup in Zapier:**
1. **Trigger:** "New Google Form Response"
   - Connect your Google account
   - Select the "Curator Outreach Queue" form
2. **Action:** "Send Direct Message" (Instagram by Zapier)
   - **Recipient:** `{Instagram Handle}` (from form)
   - **Message:** Paste the message below (copy-paste, no variables needed yet)

**Message to send:**
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

3. **Turn on Zap**
4. Test: Fill out the form with a test account handle (or your own) → Zapier should send a DM

---

## Step 3: Zap #2 — Monitor Responses & Notify You

**Trigger:** New DM to @afoot_la business account
**Action:** Detect keywords + notify

1. **Trigger:** Instagram → **New Instagram Direct Message** to @afoot_la
2. **Filter:** Only if message contains keywords (yes, interested, cool, yeah, let's, down, etc.)
3. **Action 1:** Add to Google Sheet (track all curator interest)
   - Columns: Date, Sender IG Handle, Message, Status (new/contacted/approved)
4. **Action 2:** Send you an email notification
   - **To:** your email
   - **Subject:** `🎉 New Curator Interested: {Sender Name}`
   - **Body:** 
     ```
     Account: @{sender_name}
     Message: {message_text}
     
     Next: Review their form response and approve in Afoot admin.
     ```
5. **Action 3 (optional):** Send the curator an auto-reply
   - **Message:**
     ```
     awesome! thanks for the interest. quick form to get rolling:
     [GOOGLE FORM LINK BELOW]
     ```

**Setup the Google Sheet to track interest:**
- Column A: Date (auto-filled by Zapier)
- Column B: IG Handle (from sender)
- Column C: Message (what they said)
- Column D: Your status (new / sent-form / approved / active / paused)

---

## Step 4: Auto-Send Curator Intake Form

**When:** After they respond positively (or after you manually approve in Afoot admin)
**What:** Google Form with 4 quick questions

**Google Form Questions:**
```
1. What kind of events do you usually post about?
   (Checkboxes: Music, Art/Galleries, Nightlife, Comedy, Food, Neighborhoods, Other)

2. How often do you post event recommendations?
   (Radio: Daily, 2-3x per week, Weekly, Every other week)

3. Best way to send us event tips?
   (Radio: DM here, Email to afoot@somedude.app, Web form on Afoot, Doesn't matter)

4. We'll credit you as @{your_handle}—is that cool?
   (Checkboxes: Yes, use my handle | Yes, but use a different name | No, stay anonymous)

5. Anything else we should know?
   (Text field, optional)
```

**In Zapier:**
1. After the curator responds positively, add an **Delay** action (wait 2 minutes, so they see your message)
2. **Action:** Send a new Instagram DM
   - **Message:** 
     ```
     awesome! quick form to get rolling, takes 30 seconds:
     [LINK TO FORM]
     ```
3. **Action:** Add their handle to a Google Sheet column "awaiting-form-response"

---

## Step 5: Webhook to Afoot Admin Dashboard

This is optional but nice: **notify you in Afoot admin when a curator signs up.**

**Setup:**
1. In Afoot admin, you'll need to add a simple webhook handler
   - Create an `/api/curators/webhook` endpoint that:
     - Receives a POST with { ig_handle, timestamp }
     - Stores it in a "curator_signup_queue" table
     - Shows a notification in /admin
2. In Zapier, after the curator submits the form:
   - **Action:** Webhooks by Zapier → POST
   - **URL:** `https://afoot.somedude.app/api/curators/webhook`
   - **Headers:** `Authorization: Bearer [CURATOR_WEBHOOK_TOKEN]`
   - **Data:** 
     ```json
     {
       "ig_handle": "{sender_name}",
       "form_link": "{form_response_link}",
       "timestamp": "{current_timestamp}"
     }
     ```

If this feels like overkill, skip it for now. You can just check your Google Sheet daily.

---

## Step 6: Monthly Curator Reports (Bonus)

**Track curator activity** in Afoot admin:
- How many events did each curator submit?
- How many got posted?
- How many got RSVPs? (if that data is available)
- When did they go quiet? (last submission date)

This helps you decide which curators are worth nurturing.

---

## Cost Breakdown

| Item | Cost |
|---|---|
| Zapier | $29/month (Pro plan, includes webhooks) |
| Google Form | Free |
| Google Sheet | Free |
| IG Business Account | Free (convert a regular account) |
| Email notifications | Free (included in Zapier) |
| **Total** | **~$30/month** |

If you're only sending 5 DMs a day (25/week), you don't need the Pro plan initially. Start on **Zapier Free (~$0)**, then upgrade to Pro only when you're ready to automate the form sending.

---

## Troubleshooting

**"DM not sending"**
- Check @afoot_la is a business account (not personal)
- Check you approved Zapier in Instagram settings
- Zapier may rate-limit: space DMs out (max 10 per hour per receiver)

**"Filter not catching responses"**
- Add more keywords to the filter: "yeah", "cool", "let's do it", "down", "yes please"
- Check the exact wording curators use—test with 1–2 responses first

**"I don't see form responses in my Google Sheet"**
- Check form submission notifications are on in Google Forms
- Zapier may need 5–10 minutes to pick up new submissions (refresh the Zap history)

**"Too many notifications"**
- Set Zapier to only notify for HIGH priority responses (curators with 10k+ followers, e.g.)
- Digest notifications: Zapier can batch them into 1 email per day instead of per-event

---

## Next: Curator Onboarding (Manual, 2-min per curator)

Once they fill out the form, you:
1. ✅ Approve in Afoot admin (or deny if they're not a good fit)
2. Send them a one-line email:
   ```
   You're live on Afoot! When you post an event, just DM @afoot_la 
   with a link (or the details) and we'll add it + credit @{their_handle}.
   ```
3. Add them to your Curator Partners sheet
4. Monitor their submissions for the first month

Done. The rest is them sending you event tips, you reviewing + posting.

---

## Alternative: Code-Based (if you prefer)

If you want to skip Zapier and build the IG automation directly in Afoot, you'd use:
- `instagram-private-api` (Node library, unofficial but works)
- Scheduled job (GitHub Actions or systemd) to check @afoot_la DMs every 2 hours
- Same keyword matching + notification system

**Pros:** Full control, no Zapier cost, can integrate directly into Afoot admin.
**Cons:** Takes 4–6 hours to build, Instagram can break unofficial APIs without warning, need to handle auth carefully.

**Decision:** Start with Zapier (5 min setup, proven), migrate to code later if you want deeper integration.
