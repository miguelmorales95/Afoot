// Map a newsletter sender to a venue, so inbound emails route correctly.
//
//   npm run newsletter:add -- <venue-slug> <sender>  [keyword]
//
// <sender> can be an address (news@smogcitybrewing.com) or a bare domain
// (mcsv.net for a Mailchimp sender). Optionally add a keyword that identifies
// the venue in the subject/body (useful for shared ESP domains like substack).
//
// Examples:
//   npm run newsletter:add -- smog-city-torrance news@smogcitybrewing.com
//   npm run newsletter:add -- zebulon-la substack.com "Zebulon"

import "./env";

import { supabase } from "../lib/supabase";

async function main() {
  const [slug, sender, keyword] = process.argv.slice(2);
  if (!slug || !sender) {
    console.error("Usage: npm run newsletter:add -- <venue-slug> <sender> [keyword]");
    process.exit(1);
  }

  const { data: venue, error } = await supabase
    .from("venues")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!venue) {
    console.error(`No venue with slug "${slug}".`);
    process.exit(1);
  }

  const isAddress = sender.includes("@");
  const row = {
    venue_id: venue.id,
    from_address: isAddress ? sender.toLowerCase() : null,
    from_domain: isAddress ? null : sender.toLowerCase().replace(/^www\./, ""),
    match_keyword: keyword ?? null,
    label: `${venue.name} newsletter`,
    active: true,
  };

  const { error: insErr } = await supabase.from("newsletter_sources").insert(row);
  if (insErr) throw insErr;

  console.log(`Linked ${sender}${keyword ? ` (keyword "${keyword}")` : ""} -> ${venue.name}.`);
}

main().then(() => process.exit(0));
