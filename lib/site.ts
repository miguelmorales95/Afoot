// Small bits of client-safe site config.

export const SUGGEST_EMAIL =
  process.env.NEXT_PUBLIC_SUGGEST_EMAIL || "";

/** A prefilled mailto: link for suggesting a venue/site. */
export function suggestMailto(): string {
  const subject = encodeURIComponent("New venue for Afoot");
  const body = encodeURIComponent(
    [
      "Venue name:",
      "Website:",
      "Events / calendar page (if any):",
      "Newsletter signup (if any):",
      "Neighborhood:",
      "What kind of events (karaoke, game night, live music, etc.):",
    ].join("\n"),
  );
  return `mailto:${SUGGEST_EMAIL}?subject=${subject}&body=${body}`;
}
