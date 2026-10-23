# Afoot — Design Notes

Afoot follows the **company-wide design system**: see [`Company-Design-System.md`](https://github.com/miguelmorales95/SomeDude_Company/blob/main/Company-Design-System.md) (the source of truth for shared color tokens, typography, spacing/radius, motion, components, and accessibility).

## Afoot's personality within the system
- **Mood:** dark, modern, nightlife energy — fast and open, "Craigslist for events."
- **Theme:** dark, near-black surfaces with electric magenta/cyan accents, mapped to the shared `--accent` / `--brand-2` token names.
- **Illustration:** map-forward and photographic (venue imagery), neon accents on dark — not cute characters.
- **Tone:** quick, local, no-friction; privacy-first (no tracking) is part of the brand.

## Keeping listings accurate (trust patterns)
Afoot is the company reference for "please check this" UI (see the design system's §8b):
- **Unconfirmed details:** amber pills on the event card — "Time unconfirmed", "Date unconfirmed", "Location unconfirmed", "Price unconfirmed". Red is only for "Reported cancelled", with the title struck through.
- **One-tap check:** a small amber row under the card, e.g. "Does this start at 8:00 PM?" with Yes / No / Not sure. Each browser is asked once per detail.
- **⚑ Report / Rate or report:** a quiet link at the bottom right of each card opens a menu. After an event starts, "How was it?" tips come first (Great vibe, Hard to park, Too crowded, Not as described, Not accessible, Felt unsafe); then red-tinted listing problems (Wrong time or place, Cancelled, Scam or spam, Not a real event, Duplicate, Inappropriate) with an optional note.
- **Heads-up tips** show as small chips with an emoji and a count ("🚗 Hard to park · 3"); they inform, never remove.
- Copy in the menu says plainly: no account needed, no IP or identity stored.
- Feedback controls sit inside the card link, so every control stops the tap from opening the event.

## What to change to align
- Map the **Tailwind theme values to the shared token names** so a shared sign-in, avatars, and cards match the other apps while keeping the dark/neon look.
- Adopt the shared **auth screen**, **avatar** (with profile), and **map / "near me"** components from `@company/ui` as they land.
- Keep the existing privacy-first ad system; monetization leans on sponsorship / paid venue placement (see the roadmap), not tracking-based ads.

See also the [Company Roadmap & Launch Plan](https://github.com/miguelmorales95/SomeDude_Company/blob/main/Company-Roadmap-and-Launch-Plan.md) for where Afoot sits in the launch sequence (it ships first).
