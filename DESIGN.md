# WhatsUp LA — Design Notes

WhatsUp follows the **company-wide design system**: see `Desktop/MASTER/Company-Design-System.md` (the source of truth for shared color tokens, typography, spacing/radius, motion, components, and accessibility).

## WhatsUp's personality within the system
- **Mood:** dark, modern, nightlife energy — fast and open, "Craigslist for events."
- **Theme:** dark, near-black surfaces with electric magenta/cyan accents, mapped to the shared `--accent` / `--brand-2` token names.
- **Illustration:** map-forward and photographic (venue imagery), neon accents on dark — not cute characters.
- **Tone:** quick, local, no-friction; privacy-first (no tracking) is part of the brand.

## What to change to align
- Map the **Tailwind theme values to the shared token names** so a shared sign-in, avatars, and cards match the other apps while keeping the dark/neon look.
- Adopt the shared **auth screen**, **avatar** (with profile), and **map / "near me"** components from `@company/ui` as they land.
- Keep the existing privacy-first ad system; monetization leans on sponsorship / paid venue placement (see the roadmap), not tracking-based ads.

See also the [Company Roadmap & Launch Plan](../MASTER/Company-Roadmap-and-Launch-Plan.md) for where WhatsUp sits in the launch sequence (it ships first).
