// Admin review logic: combine community submissions and crawler-discovered
// candidates into one queue, drop anything we already track, and group by site
// so duplicate suggestions for the same venue collapse into a single card.

import { supabase } from "./supabase";
import { registrableDomain } from "./domain";
import type { ReviewGroup, ReviewSource } from "./types";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export async function getReviewGroups(): Promise<ReviewGroup[]> {
  // Domains we already have — used to drop suggestions we already track.
  const { data: venues } = await supabase.from("venues").select("website");
  const existing = new Set<string>();
  for (const v of venues ?? []) {
    const d = v.website ? registrableDomain(v.website) : null;
    if (d) existing.add(d);
  }

  const { data: submissions } = await supabase
    .from("submissions")
    .select("id, venue_name, website, events_url, city, note, created_at")
    .eq("status", "pending");

  const { data: candidates } = await supabase
    .from("candidate_venues")
    .select("id, venue_name, domain, url, events_url, newsletter_url, neighborhood, city, address, score, reason, created_at")
    .eq("status", "new");

  const groups = new Map<string, ReviewGroup>();

  const ensure = (domain: string): ReviewGroup => {
    let g = groups.get(domain);
    if (!g) {
      g = {
        domain,
        name: domain,
        website: null,
        events_url: null,
        newsletter_url: null,
        neighborhood: null,
        city: null,
        sources: [],
        score: null,
      };
      groups.set(domain, g);
    }
    return g;
  };

  for (const c of candidates ?? []) {
    const domain = c.domain as string;
    if (!domain || existing.has(domain)) continue;
    const g = ensure(domain);
    if (c.venue_name) g.name = c.venue_name;
    g.website = g.website || c.url || `https://${domain}`;
    g.events_url = g.events_url || c.events_url || null;
    g.newsletter_url = g.newsletter_url || c.newsletter_url || null;
    g.neighborhood = g.neighborhood || c.neighborhood || null;
    g.city = g.city || c.city || null;
    g.address = g.address || c.address || null;
    if (typeof c.score === "number") g.score = Math.max(g.score ?? 0, c.score);
    g.sources.push({
      kind: "discovery",
      id: c.id,
      note: c.reason ?? null,
      score: c.score ?? null,
      created_at: c.created_at ?? null,
    } as ReviewSource);
  }

  for (const s of submissions ?? []) {
    const domain = s.website ? registrableDomain(s.website) : null;
    if (!domain || existing.has(domain)) continue;
    const g = ensure(domain);
    // Prefer a human-provided name only if we don't already have one.
    if (s.venue_name && g.name === domain) g.name = s.venue_name;
    g.website = g.website || s.website || `https://${domain}`;
    g.events_url = g.events_url || s.events_url || null;
    g.city = g.city || s.city || null;
    g.sources.push({
      kind: "submission",
      id: s.id,
      note: s.note ?? null,
      score: null,
      created_at: s.created_at ?? null,
    } as ReviewSource);
  }

  // Submissions (human intent) first, then by discovery confidence.
  return [...groups.values()].sort((a, b) => {
    const aSub = a.sources.some((x) => x.kind === "submission") ? 1 : 0;
    const bSub = b.sources.some((x) => x.kind === "submission") ? 1 : 0;
    if (aSub !== bSub) return bSub - aSub;
    return (b.score ?? 0) - (a.score ?? 0);
  });
}

export interface ActionInput {
  action: "approve" | "reject";
  group: ReviewGroup;
}

export async function applyAction(input: ActionInput): Promise<{ ok: boolean; note?: string }> {
  const { action, group } = input;
  const submissionIds = group.sources.filter((s) => s.kind === "submission").map((s) => s.id);
  const candidateIds = group.sources.filter((s) => s.kind === "discovery").map((s) => s.id);

  if (action === "reject") {
    if (submissionIds.length)
      await supabase.from("submissions").update({ status: "rejected" }).in("id", submissionIds);
    if (candidateIds.length)
      await supabase.from("candidate_venues").update({ status: "rejected" }).in("id", candidateIds);
    return { ok: true, note: "rejected" };
  }

  // approve -> create the venue, then mark sources handled.
  const { error: insErr } = await supabase.from("venues").upsert(
    {
      name: group.name,
      slug: slugify(group.name) || slugify(group.domain),
      website: group.website || `https://${group.domain}`,
      events_url: group.events_url || null,
      newsletter_url: group.newsletter_url || null,
      // Only when known, so approving never blanks an address already on the venue.
      ...(group.address ? { address: group.address } : {}),
      city: group.city || group.neighborhood || "Los Angeles",
      description: group.neighborhood ? `${group.neighborhood} — added from review queue.` : null,
      source: submissionIds.length ? "submission" : "sourced",
      active: true,
    },
    { onConflict: "slug" },
  );
  if (insErr) return { ok: false, note: insErr.message };

  if (submissionIds.length)
    await supabase.from("submissions").update({ status: "approved" }).in("id", submissionIds);
  if (candidateIds.length)
    await supabase.from("candidate_venues").update({ status: "promoted" }).in("id", candidateIds);

  return { ok: true, note: "approved" };
}
