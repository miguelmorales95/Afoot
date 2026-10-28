# Afoot

Aggregates the **small, hard-to-find local events** — karaoke, board game nights, open mics,
neighborhood shows — that never make it onto Eventbrite/Dice/Partiful. It pulls events from
venue **calendar pages** (and, soon, **newsletters**), expands recurring events into real dates
with an LLM, and shows you what's on near you. No logins. Ad-supported.

LA-focused for now.

## See it right now (demo mode)

No Supabase, no keys — just the design with realistic sample LA events:

```bash
npm install
npm run dev     # http://localhost:3000  → search "Echo Park" or "Torrance"
```

When Supabase isn't configured the app auto-serves built-in sample data, so you can explore the
**List / Table / Map** views, filters, tags, and the submit flow immediately. Wire up the real
database (below) when you're ready to ingest live events.

### Test with real events from a CSV (no database)

`data/events.csv` holds researched, real LA events with source links. To serve the feed from it:

```bash
echo "LOCAL_EVENTS_FILE=data/events.csv" >> .env.local
npm run dev
```

The file takes priority over demo mode and Supabase. Search uses real geocoding in this mode.
Columns are documented in `lib/localEvents.ts`.

- `npm run geocode:csv`: fill in `venue_lat` / `venue_lng` for new rows (Nominatim, 1 request/second)
- `npm run import:csv -- --dry-run`, then `npm run import:csv`: load the file into Supabase. Re-running
  updates rows instead of duplicating them.

On Vercel, set `LOCAL_EVENTS_FILE=data/events.csv` in the project's environment variables. Submissions
and `/admin` still need Supabase.

---

## How it works

```
Venue calendar page ─┐
Newsletter email ────┼─▶ fetch text ─▶ Claude extracts + expands recurrence ─▶ Supabase
Venue IG/FB (later) ─┘                        (one source-agnostic prompt)         │
                                                                                   ▼
Browser ──▶ /api/geocode (your location) ──▶ /api/events ──▶ nearby_events() RPC ──┘
```

The core bet: instead of brittle per-site scrapers, **Claude turns messy page text into
structured events** and expands things like *"Every 2nd & 4th Tuesday"* into concrete dates.
The same extractor will later take newsletter email bodies — the prompt doesn't care about the
source.

## Tech stack

- **Next.js** (App Router, TypeScript) — site + API routes, deploys to Vercel
- **Supabase** (Postgres) — venues, events, occurrences, submissions, discovered candidates; haversine `nearby_events` RPC
- **LLM** — Claude (`claude-haiku-5-5`) **or local Ollama** for extraction + discovery (set `LLM_PROVIDER`)
- **Web search** — DuckDuckGo (keyless) or Brave API — powers the discovery crawler
- **Nominatim** (OpenStreetMap) — free geocoding, no key

## Two pipelines

1. **Discovery** (`npm run discover`) — searches the web for likely LA venues, classifies each
   site with the LLM, and fills a `candidate_venues` table (name, neighborhood, events page,
   newsletter signup, confidence). You review/approve, then `npm run promote` turns approvals
   into real venues. Runs great on local Ollama so you can leave it going for hours before launch.
2. **Ingestion** (`npm run ingest`) — for each venue, fetches its events page, has the LLM
   extract + expand events, and writes occurrences to the feed.

The front end offers **List**, sortable **Table**, and **Map** views, with category filters and
vibe/activity **tags** pulled from each event.

### Newsletters (the differentiator)

Most small venues announce events only in a weekly email. Two ways to capture them, both feeding
the same source-agnostic extractor (tagged `source: "newsletter"`):

- **IMAP poller** (`npm run newsletters -- --loop`) — subscribe a dedicated inbox to venue
  newsletters, set `IMAP_*` in `.env.local`, and leave it polling. No domain needed.
- **Inbound webhook** (`/api/inbound-email`) — point a provider's parse hook here (Cloudflare
  Email Worker in `docs/cloudflare-email-worker.js`, or SendGrid/Mailgun/Postmark).

Emails are matched to a venue by sender address/domain, body links, or a keyword. Map a sender:

```bash
npm run newsletter:add -- smog-city-torrance news@smogcitybrewing.com
npm run newsletter:add -- zebulon-la substack.com "Zebulon"   # shared ESP domain + keyword
```

Unmatched emails are logged in `inbound_emails` for review.

### Accounts, RSVP & private contact exchange

Optional, privacy-first social layer:

- **Sign in** with Google/Facebook (Supabase Auth) — enable the providers in the Supabase
  dashboard and add `<site>/auth/callback` as a redirect URL. One tap, no passwords.
- **RSVP, but attendance is private.** "I'm going" never shows a public count or attendee list.
  The going-count is used **only** server-side (`nearby_events`) to **rank** events, and RSVP is
  the **key that unlocks the event chat**.
- **Event chat (gated + moderated)** — only people who RSVP'd can read or post (`messages` RLS +
  `occurrence_messages` RPC); you only see who else is going **from inside** the chat. Messages
  support report + block; a light client profanity mask runs on send.
- **Contact exchange** — inside the chat you can **request** someone's contact; they **approve or
  deny** from their **`/inbox`**; the number is revealed to the requester only on approval. Phones
  live in private `profiles` rows guarded by RLS and are never shown in the chat.
- **Moderation** — `blocks` + `reports` tables; blocked users' messages are hidden for you.
- **Demo mode** — with no Supabase configured, sign-in/RSVP/requests are simulated in
  `localStorage` so the whole flow is clickable offline.

### Event feedback: flags, tips, and checks

Afoot keeps listings accurate with help from the people using it. No account is needed.

- **Report (⚑)**, modeled on Craigslist flags: wrong time or place, cancelled, scam or spam,
  not a real event, duplicate, inappropriate. Scam / not real / inappropriate reports from
  **3 different devices hide the event** until it's reviewed; "cancelled" from **2 devices
  marks that date cancelled**.
- **Heads up**, after an event starts: hard to park, too crowded, not as described, not
  accessible, felt unsafe, great vibe. Shown as tips on the event's series; never removes it.
- **One-tap checks** on uncertain details ("Does this start at 8pm?"). Events carry a
  `confidence` and `uncertain_fields`; **2 "yes" answers** from different devices confirm a
  detail, and 2 "no" answers send it to `/admin`.

Each browser keeps a random id in localStorage; the server stores only a salted hash
(`DEVICE_HASH_SALT`), never an IP. Each device can send 30 pieces of feedback a day. Flagged
events appear at the top of `/admin` with **Looks fine**, **Hide event**, and **Restore**.
Thresholds live in `app/api/feedback/route.ts`.

### Admin review (`/admin`)

A single screen to triage what to add. It merges community **submissions** and crawler-discovered
**candidates**, **drops any site you already track**, and **groups duplicate suggestions by site**
(so three people suggesting the same bar show as one card). Approve to create the venue (the next
ingest pulls its events); reject to dismiss. **Set `ADMIN_TOKEN` in production:** without it the
admin routes refuse everyone on a deployed site (they're open only in local development).

### JS-rendered sites (Zebulon, etc.)

Sites whose calendars load via JavaScript are handled by a headless-browser fallback (Playwright)
that kicks in automatically when a plain fetch is thin — or set `venues.render = true` to force it.
Enable it once:

```bash
npm i -D playwright && npx playwright install chromium
```

Best run locally or on a VM (Playwright doesn't fit Vercel's serverless functions); the daily
cron on Vercel handles the plain-fetch venues.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run **`supabase/schema.sql`** then **`supabase/seed.sql`**. Everything
   is created in an **`afoot` schema** so Afoot can share a Supabase project with other apps.
3. In **Project Settings → Data API → Exposed schemas**, add `afoot`.
4. Grab **Settings → API Keys**: the project URL, the publishable key, and the secret key.

### 3. Environment

```bash
cp .env.example .env.local
```

Fill in:

| Var | What |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (**server-only**, never ship to the browser) |
| `ANTHROPIC_API_KEY` | From console.anthropic.com |
| `EXTRACTION_MODEL` | `claude-haiku-5-5` (bump to `claude-sonnet-5-5` for tougher pages) |
| `NOMINATIM_EMAIL` | Your email (Nominatim's usage policy requires a contact) |
| `TICKETMASTER_API_KEY` | Optional. Free Discovery API key (developer.ticketmaster.com): reads Ticketmaster links and venue feeds |
| `EVENTBRITE_TOKEN` | Optional. Eventbrite private token (eventbrite.com → Account settings → Developer links → API keys): organizer feeds. Eventbrite links read fine without it |
| `CRON_SECRET` | A long random string (`openssl rand -hex 32`). **Required:** without it the scheduled ingest route refuses to run |
| `OLLAMA_NUM_CTX` | Local model's context window (default 16384); Ollama's own default drops most of a long page |
| `OLLAMA_TIMEOUT_MS` | How long to wait for the local model per page (default 120000). On a machine without a GPU a long page can take over 5 minutes, which hits Node's own request limit: use Anthropic for bulk ingests there |

### 4. Discover venues (optional but recommended before launch)

Build up the venue database by scanning the web. Free + local with Ollama:

```bash
# in .env.local: LLM_PROVIDER=ollama, OLLAMA_MODEL=llama3.1
ollama pull llama3.1
npm run discover -- --loop        # keeps finding candidates, pass after pass

# review candidates in Supabase, then:
npm run promote -- --auto 0.75    # approve + promote high-confidence finds
```

Or approve by hand in the Supabase table UI (`candidate_venues.status = 'approved'`) and run
`npm run promote`.

Or start from a hand-picked list instead of (or before) the crawler: `data/la-venues.csv` holds
40 small LA venues (bookstores, jazz and music rooms, comedy, breweries, galleries) with their
public sites. `npm run seed:venues -- --dry-run` shows what it would add; `npm run seed:venues`
puts the new ones in the review queue (`candidate_venues`), where `/admin` or
`npm run promote -- --auto 0.9` turns them into venues. No AI or web requests involved.

### 5. Geocode + ingest

```bash
npm run geocode   # fills lat/lng for venues that only have an address
npm run ingest    # fetches each venue page, extracts events, writes to Supabase
```

Ingest just one venue while testing:

```bash
npm run ingest -- smog-city-torrance
```

Preview without writing anything (check recurring events expand to the right dates):

```bash
npm run ingest -- --dry-run smog-city-torrance             # one venue, printed in LA time
npm run ingest -- --url https://example.com/events --name "Some Bar"   # any page, no DB row
```

### 5b. Events from links and other apps

- **Anyone can paste an event link on `/submit`** ("Add an event"): Facebook, Eventbrite, Ticketmaster,
  Meetup or a venue's page. The server reads the event (the official API when a key is set, otherwise the
  event data pages carry for search engines, then the AI as a last resort) and it waits in `/admin` under
  *Event links*, editable, until someone publishes or rejects it. Facebook usually hides events from
  visitors who aren't signed in, so the form also asks for the name, date and place. Afoot never signs in
  to Facebook or uses accounts to scrape it.
- **Feeds** (`/admin` → *Event feeds*): an Eventbrite organizer (its `eventbrite.com/o/...` page) or a
  Ticketmaster venue (`npm run ticketmaster:venues -- "Lodge Room"` finds its id). `npm run feeds` pulls
  their upcoming events daily in the GitHub Actions job.
- Events from links and feeds go to a matching venue (same name, or within ~60 m) or a new one, which
  starts paused for scraping. Public links are fetched only from public addresses (`lib/safeFetch.ts`).
- Tables: `event_links`, `event_feeds` (migration `20261029010000`; apply with `npm run migrate -- <file>`
  after `npm run backup:db`).

### 6. Run

```bash
npm run dev        # http://localhost:3000
```

Search a neighborhood (e.g. *Torrance*) or click **use my current location**.

---

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel.
2. Add all the env vars from `.env.local` in the Vercel project settings.
3. The daily import runs on **GitHub Actions** (`.github/workflows/ingest.yml`, 9:00 UTC), not on
   Vercel: Vercel's functions can't run the headless browser some calendars need and stop after
   5 minutes. Add the repository secrets `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
   `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions); run it by hand from the Actions
   tab. `/api/cron/ingest` (with `CRON_SECRET`) remains for a one-off run on Vercel, for up to
   4 minutes, longest-waiting venues first.
4. Re-ingesting never deletes a date anyone RSVP'd to or chatted about: if the venue drops it,
   it's marked cancelled instead. Other dates the page no longer lists are removed.

---

## Project layout

```
app/
  page.tsx                  # home feed: search + List/Table/Map views + filters
  submit/page.tsx           # "add a venue" form (no login)
  admin/page.tsx            # review queue: submissions + candidates, grouped/deduped
  api/admin/review/route.ts # GET queue / POST approve|reject (ADMIN_TOKEN gated)
  api/events/route.ts       # GET nearby events (nearby_events RPC, or demo data)
  api/geocode/route.ts      # GET place name -> lat/lng (Nominatim proxy)
  api/submit/route.ts       # POST venue submission
  api/cron/ingest/route.ts  # scheduled ingestion (Vercel Cron)
  api/inbound-email/route.ts # ⭐ newsletter webhook (provider-agnostic)
  api/admin/sponsors/route.ts # sponsors + campaigns for /admin (ADMIN_TOKEN gated)
  api/ads/live/route.ts     # GET live sponsor campaigns (card text only, CDN-cacheable)
  api/ads/seen/route.ts     # POST batched sponsor views (counts only)
  go/[campaignId]/route.ts  # sponsor click: +1, then redirect with UTM tags
components/
  EventsTable.tsx           # sortable table view
  EventsMap.tsx             # Leaflet map view (dynamic, client-only)
  AdUnit.tsx / AdRail.tsx   # ad slots: sponsor -> network -> house promo
  SponsorCard.tsx           # paid card with "Sponsored" + "Why am I seeing this?"
  SponsorAdmin.tsx          # /admin Sponsors section
lib/
  llm.ts                    # ⭐ provider-agnostic LLM (Claude OR local Ollama)
  extract.ts                # event extractor (events + recurrence expansion + tags)
  ingest.ts                 # ingestion orchestration: fetch -> extract -> upsert
  discover.ts               # ⭐ web discovery: search -> classify -> candidate_venues
  newsletter.ts             # ⭐ inbound email -> match venue -> extract events
  search.ts                 # web search (DuckDuckGo keyless / Brave API)
  discovery-queries.ts      # LA neighborhoods x activities query generator
  domain.ts                 # domain dedupe + aggregator/social skip-list
  scrape.ts                 # HTTP fetch + HTML->text + headless Playwright fallback
  geocode.ts                # Nominatim client
  demo.ts                   # built-in sample data for demo mode
  supabase.ts               # server-only Supabase client (lazy)
  format.ts                 # client-safe date/category/tag display helpers
  site.ts                   # public config (suggest-a-venue email)
  ads.ts                    # ad providers, house promos, campaign types, visitor area
  campaigns.ts              # server: live campaigns (60 s cache), view/click counters
  sponsorClient.ts          # browser: load campaigns, report seen cards by beacon
  types.ts
scripts/
  discover.ts               # CLI: web discovery crawler (--loop to leave running)
  promote.ts                # CLI: approved candidates -> venues
  ingest.ts                 # CLI: run ingestion
  newsletters.ts            # CLI: IMAP poller for newsletter inboxes (--loop)
  add-newsletter-source.ts  # CLI: map a newsletter sender -> venue
  geocode-venues.ts         # CLI: backfill venue coordinates
  ads-report.ts             # CLI: monthly sponsor reports (npm run ads:report)
supabase/
  schema.sql                # tables + nearby_events() + RLS
  seed.sql                  # the 3 starter venues
  migrations/               # standalone changes to apply on their own (sponsor campaigns)
docs/
  cloudflare-email-worker.js # inbound-email Worker for the newsletter webhook
```

---

## Revenue & privacy

Ads are **side-rail only** (next to the table/map on desktop; hidden on small screens to keep old
phones fast), **cookieless, and do not track users**. Set the provider with
`NEXT_PUBLIC_AD_PROVIDER`:

- **`house`** (default) — sponsor cards you control (see [Sponsors](#sponsors)) and house promos
  (`lib/ads.ts`). Zero external scripts, zero tracking. The built-in "Your spot here" card is how you sell inventory directly (flat-rate).
- **`ethicalads`** — [EthicalAds](https://www.ethicalads.io/): contextual, privacy-respecting, no
  cookies. Set `NEXT_PUBLIC_ETHICALADS_PUBLISHER`. The recommended network for this project.
- **`adsense`** — Google AdSense. It works, but it **tracks users** — only use it if you accept
  that. Set `NEXT_PUBLIC_ADSENSE_CLIENT` / `NEXT_PUBLIC_ADSENSE_SLOT_RAIL`.

Browsing needs no account and sets no cookies; the full, plain-language list of what Afoot does
collect (optional sign-in, feedback hashes, cookieless visit counts) is the privacy page at
`/privacy` (`app/privacy/page.tsx`). Update it whenever a change alters what is collected. That's the "Craigslist for events" stance: fast, open, and
light enough to work on an old phone.

## Sponsors

**Site traffic** for sponsor pitches comes from Vercel Web Analytics (`<Analytics />` in `app/layout.tsx`):
page visits per day and per page, with no cookies and nothing that follows a person across days. Turn it
on under the afoot project's **Analytics** tab in Vercel.

Paid local sponsors are sold directly at a flat rate (see the Afoot Sponsorship Playbook in the
company docs) and managed in **`/admin` → Sponsors**. Set-up once: apply
`supabase/migrations/20261023120000_sponsor_campaigns.sql` (also at the end of `schema.sql`).
Until then the site behaves as before, with house promos in every slot.

- **Add a sponsor:** *+ New sponsor* (business name, contact, email for the monthly report,
  optional Stripe customer id, notes such as their promo phrase).
- **Add a campaign:** *+ Campaign* on the sponsor. Pick the product, the area (a launch area from
  `lib/areas.ts`, or *All areas*), dates (inclusive, LA time) and paste the approved card text
  (badge, title ~30 chars, line ~90, button ~20, link). The form shows a live preview.
  - **Area sponsor card:** fills the ad slots (side rail on desktop, the card under the list on
    phones) for people browsing that area. Fill order per slot: sponsor → ad network → house promo.
  - **Featured event:** search for the event; its next date is pinned in a *Featured* block above
    the list (list view only) for people browsing that area, labeled *Featured* and *Sponsored*.
- **Status:** `draft` → `approved` → `live` (shows while today is within its dates) → `paused` /
  `ended`. Changes reach the site within about a minute (live campaigns are cached for 60 s).
- Every paid card says **Sponsored** and has a *Why am I seeing this?* note: "Afoot shows the same
  sponsor to everyone browsing this area. We don't track you."

**Which area a visitor is browsing** is worked out in the browser: the neighborhood chip they
tapped, or the launch area within ~6 km of the place they searched or their location (nearest
wins). The browser downloads all live campaigns (`/api/ads/live`, identical for everyone) and picks
locally, so no location is sent for ads.

**Counting (counts only):**

| Number | How | Stored |
|---|---|---|
| Views | A paid card at least 50% on screen, once per page view; ids are batched and sent with `navigator.sendBeacon` to `/api/ads/seen` when the page is hidden | +1 on `(campaign, day)` in `campaign_daily` |
| Clicks | The card links to `/go/<campaign>`, which adds +1 and redirects (302) to the sponsor's link with `utm_source=afoot&utm_medium=sponsor&utm_campaign=<area>` | +1 on `(campaign, day)` |

Nothing else is stored: no cookies, IPs, device ids or user agents (the user agent is only read
to skip obvious bots). Days are Los Angeles days. Because nothing identifies a visitor, counts can
be inflated by someone scripting a real browser; treat sudden spikes with suspicion rather than
adding tracking to stop them.

**Monthly report:** `npm run ads:report -- --month 2026-10` writes, for each sponsor with activity
that month, `reports/ads/2026-10/<sponsor>.html` and `.txt` (views, clicks and click rate per week,
the card text, and a promo-phrase suggestion). `reports/` is gitignored. Add `--send` to also email
each sponsor's contact through Resend; that needs `RESEND_API_KEY` and `ADS_REPORT_FROM` in
`.env.local` (a sender on a domain verified in Resend). Without `--month` it reports last month.

## Known limitations & next steps

These are deliberate MVP cuts, roughly in priority order:

1. **Playwright rendering is local/VM only.** The headless fallback (for Zebulon et al.) works
   great from `npm run ingest` on your machine, but doesn't fit Vercel's serverless functions.
   Run rendered ingestion on a small always-on box (or GitHub Action), and let the Vercel cron
   handle the plain-fetch venues. A hosted browser (Browserless/ScrapingBee) is a drop-in swap.
2. **Submissions are collected but not auto-approved.** They land in the `submissions` table as
   `pending`. Add a tiny admin view (or just the Supabase table UI) to approve → promote to a
   `venues` row, then let the next ingest pick it up.
3. **Recurrence expansion is LLM-computed.** Cheap and flexible, but spot-check dates early; if
   you see drift, use Claude (`LLM_PROVIDER=anthropic`) or a stronger Ollama model.
4. **Discovery search is keyless by default** (DuckDuckGo HTML), which can be rate-limited or
   flaky. Set `BRAVE_API_KEY` for reliable results at scale.
5. **Candidate + unmatched-newsletter review is manual** (by design, to keep quality high).
   `promote --auto <score>` auto-approves high-confidence venue finds; unmatched newsletters sit
   in `inbound_emails` until you add a sender mapping.
```

## Safety notes

- The **service role key** bypasses row-level security — it's only used server-side
  (`lib/supabase.ts`, route handlers, scripts). Never import it into a client component.
- The ingest/cron routes call the paid Claude API — the cron route is gated behind `CRON_SECRET`.
- Respect venue sites: the fetcher identifies itself and times out; keep ingestion to a
  reasonable cadence (the default cron is daily).
