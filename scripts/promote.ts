// Promote discovered candidates into real venues, which the ingest pipeline
// then scrapes for events.
//
//   npm run promote                 # promote candidates with status='approved'
//   npm run promote -- --auto 0.75  # also auto-approve candidates scoring >= 0.75
//
// Review candidates first in Supabase (or approve via SQL):
//   update candidate_venues set status='approved' where domain='...';

import { config } from "dotenv";
config({ path: ".env.local" });

import { supabase } from "../lib/supabase";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function main() {
  const autoIdx = process.argv.indexOf("--auto");
  const autoThreshold = autoIdx !== -1 ? parseFloat(process.argv[autoIdx + 1]) : NaN;

  if (!Number.isNaN(autoThreshold)) {
    const { data, error } = await supabase
      .from("candidate_venues")
      .update({ status: "approved" })
      .eq("status", "new")
      .gte("score", autoThreshold)
      .select("domain");
    if (error) throw error;
    console.log(`Auto-approved ${data?.length ?? 0} candidate(s) scoring >= ${autoThreshold}.`);
  }

  const { data: approved, error } = await supabase
    .from("candidate_venues")
    .select("*")
    .eq("status", "approved");
  if (error) throw error;

  if (!approved?.length) {
    console.log("No approved candidates to promote. Approve some first (status='approved').");
    return;
  }

  let promoted = 0;
  for (const c of approved) {
    const name = c.venue_name || c.domain;
    const baseSlug = slugify(name);
    // Keep slug unique by suffixing the domain if needed.
    const slug = baseSlug || slugify(c.domain);

    const { error: insErr } = await supabase.from("venues").upsert(
      {
        name,
        slug,
        website: c.url || `https://${c.domain}`,
        events_url: c.events_url || null,
        newsletter_url: c.newsletter_url || null,
        address: c.address || null,
        city: c.city || c.neighborhood || "Los Angeles",
        description: c.venue_type ? `${c.venue_type} — discovered via web crawl.` : null,
        source: "sourced",
        active: true,
      },
      { onConflict: "slug", ignoreDuplicates: false },
    );

    if (insErr) {
      console.error(`! ${name}: ${insErr.message}`);
      continue;
    }
    await supabase.from("candidate_venues").update({ status: "promoted" }).eq("id", c.id);
    promoted++;
    console.log(`+ promoted ${name}`);
  }

  console.log(`\nPromoted ${promoted} venue(s). Now run:  npm run geocode && npm run ingest`);
}

main().then(() => process.exit(0));
