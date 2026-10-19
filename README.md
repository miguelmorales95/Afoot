# WhatsUp LA

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

### Admin review (`/admin`)

A single screen to triage what to add. It merges community **submissions** and crawler-discovered
**candidates**, **drops any site you already track**, and **groups duplicate suggestions by site**
(so three people suggesting the same bar show as one card). Approve to create the venue (the next
ingest pulls its events); reject to dismiss. Gate it with `ADMIN_TOKEN` in production.

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
2. In the SQL editor, run **`supabase/schema.sql`** then **`supabase/seed.sql`**.
3. Grab **Settings → API**: the project URL and the **service role** key.

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
| `CRON_SECRET` | Any random string; protects the scheduled ingest route |

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

### 5. Geocode + ingest

```bash
npm run geocode   # fills lat/lng for venues that only have an address
npm run ingest    # fetches each venue page, extracts events, writes to Supabase
```

Ingest just one venue while testing:

```bash
npm run ingest -- smog-city-torrance
```

### 6. Run

```bash
npm run dev        # http://localhost:3000
```

Search a neighborhood (e.g. *Torrance*) or click **use my current location**.

---

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel.
2. Add all the env vars from `.env.local` in the Vercel project settings.
3. `vercel.json` already registers a daily cron (`9:00 UTC`) hitting `/api/cron/ingest`,
   which re-runs ingestion for every active venue. Adjust the schedule there.

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
components/
  EventsTable.tsx           # sortable table view
  EventsMap.tsx             # Leaflet map view (dynamic, client-only)
  AdSlot.tsx                # inline ad placeholder
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
  types.ts
scripts/
  discover.ts               # CLI: web discovery crawler (--loop to leave running)
  promote.ts                # CLI: approved candidates -> venues
  ingest.ts                 # CLI: run ingestion
  newsletters.ts            # CLI: IMAP poller for newsletter inboxes (--loop)
  add-newsletter-source.ts  # CLI: map a newsletter sender -> venue
  geocode-venues.ts         # CLI: backfill venue coordinates
supabase/
  schema.sql                # tables + nearby_events() + RLS
  seed.sql                  # the 3 starter venues
docs/
  cloudflare-email-worker.js # inbound-email Worker for the newsletter webhook
```

---

## Revenue & privacy

Ads are **side-rail only** (next to the table/map on desktop; hidden on small screens to keep old
phones fast), **cookieless, and do not track users**. Set the provider with
`NEXT_PUBLIC_AD_PROVIDER`:

- **`house`** (default) — sponsor cards you control (`lib/ads.ts`). Zero external scripts, zero
  tracking. The built-in "Your spot here" card is how you sell inventory directly (flat-rate).
- **`ethicalads`** — [EthicalAds](https://www.ethicalads.io/): contextual, privacy-respecting, no
  cookies. Set `NEXT_PUBLIC_ETHICALADS_PUBLISHER`. The recommended network for this project.
- **`adsense`** — Google AdSense. It works, but it **tracks users** — only use it if you accept
  that. Set `NEXT_PUBLIC_ADSENSE_CLIENT` / `NEXT_PUBLIC_ADSENSE_SLOT_RAIL`.

The site collects no accounts, sets no analytics, and only uses `localStorage` to remember your
last location on your own device. That's the "Craigslist for events" stance: fast, open, and
light enough to work on an old phone.

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
