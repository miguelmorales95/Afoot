# Afoot — Design Notes

Afoot follows the **company-wide design system**: see [`Company-Design-System.md`](https://github.com/miguelmorales95/SomeDude_Company/blob/main/Company-Design-System.md) (the source of truth for shared color tokens, typography, spacing/radius, motion, components, and accessibility).

## Afoot's personality within the system (shows as "Light Pole")
- **Mood:** loud Colby-style show posters stapled to a wooden pole: day-glo paper, heavy black type. Fast and open, "Craigslist for events."
- **Page:** dark brown (`#2b2119`) with a faint blocky wood grain (`body` background in `app/globals.css`).
- **Poster colors** (each event keeps one; two in a row never match): yellow `#fff23a`, pink `#ff5fae`, green `#86f45c`, orange `#ff9a3c`, blue `#62d8ff`, on black ink `#111`.
- **Header** (phones only) slides away while scrolling down and comes back after a deliberate scroll up (~250 px) or near the top; the day header takes its place (`--header-offset`). Screen space goes to events.
- **Notes between posters** are quieter on purpose, so they never pass for events: **ads** on newsprint (`#e8e3d6`, gray ink, "AD" / "SPONSORED" over a rule, phones and tablets only since desktop has the rail), **asks** (share an Instagram, newsletter or calendar; IG curators) on kraft (`#cdae7e`) with "take one" tear-off tickets down the right edge (Instagram, Newsletter, Calendar). Each ticket is its own button and opens the source form in a popup, with that type picked (`components/SourceForm.tsx`). One before each day's 6th card, then every 12 (`components/FeedNotes.tsx`).
- **Compact layout** (toggle in the pinned day header, remembered per device): same poster colors and Anton titles, minus the type badge, street map, gist, description and tags; parking stays.
- **Card line** (all sizes): one short line in Miguel's voice, written by Claude from the listing (facts only), behind a small "GIST" stamp. Tapped, the stamp says plainly a robot wrote it trying to sound like him: one dude covering all of LA, so tap through for details. Cards without a line fall back to the keyword gist (phones): up to 6 bold uppercase keywords, same stamp.
- **Type:** Anton (heavy condensed gothic, `next/font`, class `font-poster`) for titles, times, day headers and the logo; system sans for everything else, bold and full black on cards.
- **Logo:** a silver side-view staple gun + "LIGHT" in yellow, "POLE" in pink (`components/SiteHeader.tsx`; PNGs in `branding/`).
- **Tone:** quick, local, no-friction; privacy-first (no tracking) is part of the brand.

## Event card anatomy
- **Left column:** the time in an inked block with the poster color knocked out ("TIME TBA" when the source gave none; "UNTIL DEC 24" for runs that started earlier), then one bold schedule line ("MON, WED UNTIL 1/6": 3-letter days, commas, no "&"), then a static street map that opens a full map with directions.
- **Right column:** type badge, title (Anton), venue · distance · price, tags in sentence case ("Live band", "All-ages", "DJ") with a plain "Parking" / "No parking" tag first when known (styled like the rest: people read it as part of the event), then "I'm going" (black pill) and ⚑ on one row.
- **Line under the venue:** the card line in Miguel's voice (replaces the listing's description on desktop); without one, desktop shows the description and phones the keyword gist.
- **Stacking:** cards overlap like pasted posters, no gaps. **Lineup cards** (several shows at one venue that day) list each time + title; "See all" opens same-color cards below without the map, type or venue.
- **Day headers:** the day in Anton, colored per day; only the pinned header has the filter and map buttons.

## Keeping listings accurate (trust patterns)
Afoot is the company reference for "please check this" UI (see the design system's §8b):
- **Unconfirmed details:** amber pills on the event card — "Time unconfirmed", "Date unconfirmed", "Location unconfirmed", "Price unconfirmed". Red is only for "Reported cancelled", with the title struck through.
- **One-tap check:** a small amber row under the card, e.g. "Does this start at 8:00 PM?" with Yes / No / Not sure. Each browser is asked once per detail. For TIME TBA it asks "Know when this starts?" and "Add the time" opens a time picker in a dialog on `<body>` (a field inside the card link would follow the link).
- **⚑ Report / Rate or report:** a quiet link at the bottom right of each card opens a menu. After an event starts, "How was it?" tips come first (Great vibe, Hard to park, Too crowded, Not as described, Not accessible, Felt unsafe); then red-tinted listing problems (Wrong time or place, Cancelled, Scam or spam, Not a real event, Duplicate, Inappropriate) with an optional note.
- **Heads-up tips** show as small chips with an emoji and a count ("🚗 Hard to park · 3"); they inform, never remove.
- Copy in the menu says plainly: no account needed, no IP or identity stored.
- Feedback controls sit inside the card link, so every control stops the tap from opening the event.

## What to change to align
- Map the **Tailwind theme values to the shared token names** so a shared sign-in, avatars, and cards match the other apps while keeping the poster look.
- Adopt the shared **auth screen**, **avatar** (with profile), and **map / "near me"** components from `@company/ui` as they land.
- Keep the existing privacy-first ad system; monetization leans on sponsorship / paid venue placement (see the roadmap), not tracking-based ads.

See also the [Company Roadmap & Launch Plan](https://github.com/miguelmorales95/SomeDude_Company/blob/main/Company-Roadmap-and-Launch-Plan.md) for where Afoot sits in the launch sequence (it ships first).

## Somedude desk and emails
- **Somedude desk** (`/somedude`): same wood and poster type; "Where to look" round site icons, a kraft paste box, then a plain list (new / already on the pole / skipped) with checkboxes. A working page for one trusted person per city, not a public one.
- **Weekly email:** the app in an inbox: wood background, "LIGHT POLE" lettering, poster-colored cards with a black time block, day names in poster colors, a cream "Everything else on the pole" pill. Tables and inline styles only.
