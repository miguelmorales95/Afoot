# Inbox scan: find places and sources to track

`npm run scan:inbox` signs in to one Google account through a private browser window, looks at
that account's newsletters and calendar, and writes a list of **venues, series, promoters and
curators Light Pole should be watching**, with where each one posts its schedule.

Run it once per account (yours, family members'). Each run writes a new pair of files:

```
inbox-scans/<account>__<YYYY-MM-DD_HH-MM>.md     the report to read
inbox-scans/<account>__<YYYY-MM-DD_HH-MM>.json   everything, for importing later
```

`inbox-scans/` is gitignored: the files hold sender names and calendar entries from personal accounts.
The model used is written in each report, so a re-scan after a model upgrade can be compared with the old file.

## What it reads (and doesn't)

- **Mail:** only the sender, subject and date of newsletter-type mail (anything containing
  "unsubscribe") from the last 180 days. For each sender that looks like an LA event source, it
  reads the **newest issue only** to note the venues it mentions and where to watch them. No other
  email bodies are fetched, nothing is downloaded in bulk.
- **Calendar:** entries from 90 days back to 90 ahead. Appointments and personal items are
  dropped; public events (shows, screenings, markets…) are checked against Light Pole, and the
  places hosting the ones we miss go on the list.
- **Sign-in:** the access token lives in memory for that run only and expires within an hour.
  Nothing about the login is saved.
- **AI step:** runs on the local Ollama model by default, so nothing leaves the computer. With
  `--anthropic` it uses Claude instead (sender names, subjects and newest issues go to Anthropic).

## One-time setup (about 10 minutes)

Google requires an "OAuth client" before any script can read Gmail.

1. Go to https://console.cloud.google.com and create a project (e.g. "Light Pole inbox scan").
2. **APIs & Services → Library:** enable **Gmail API** and **Google Calendar API**.
3. **Google Auth Platform → Branding / Audience:** app name "Light Pole inbox scan", your email
   as support contact, user type **External**, leave it in **Testing**.
4. **Audience → Test users:** add every Gmail address you plan to scan (yours, family members').
   Only these accounts can sign in.
5. **Clients → Create client → Desktop app.** Copy the client ID and secret into `.env.local`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

## Running it

```
npm run scan:inbox                  # mail (180 days) + calendar
npm run scan:inbox -- --days 365    # look further back
npm run scan:inbox -- --no-calendar # mail only
npm run scan:inbox -- --anthropic   # use Claude for the AI step
```

A private Zen window opens. Pick the account, then:
- "Google hasn't verified this app" → **Continue** (expected while the app is in Testing).
- Tick both boxes (Gmail read, Calendar read) → **Continue**.

The terminal shows progress; the report path is printed at the end.

## Reading the report

1. **Places to track, not on Light Pole yet**: the main output. Each row has the place, what
   kind it is, the area, where to watch it (calendar page, site, Instagram, ticketing platform,
   newsletter address, how often it runs) and what surfaced it ("mentioned by KCRW", "your
   calendar: …"). Places that come up in several sources are listed first.
2. **Newsletters worth subscribing the Light Pole inbox to**: senders that are LA event sources
   and aren't already mapped. Subscribe the Light Pole inbox, then map venue newsletters with
   `npm run newsletter:add -- <venue-slug> <sender>`.
3. **Calendar: public events missing from Light Pole**: the raw misses, with organizer and link
   domains (dice.fm, partiful.com, ra.co…) as hints for which platforms we aren't covering.
