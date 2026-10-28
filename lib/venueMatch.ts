// Finding the Afoot venue for an event that came from a link or a feed: the same venue by name
// (or by being within ~60 m), or a new one. New venues start paused for daily scraping
// (active = false): their events come from the link or feed, not from scraping their site.
import { supabase } from "./supabase";
import { geocode } from "./geocode";
import { slugify } from "./localEvents";

export async function venueFor(v: { name: string | null; address: string | null; lat: number | null; lng: number | null; website?: string | null; source: string }): Promise<string> {
  const name = (v.name || "").trim() || "Venue to confirm";
  const slug = slugify(name);
  const { data: same } = await supabase.from("venues").select("id").eq("slug", slug).maybeSingle();
  if (same) return same.id;
  if (v.lat != null && v.lng != null) {
    const d = 0.0006; // about 60 m
    const { data: near } = await supabase.from("venues").select("id, name").gte("lat", v.lat - d).lte("lat", v.lat + d).gte("lng", v.lng - d).lte("lng", v.lng + d).limit(1);
    if (near?.length) return near[0].id;
  }
  let { lat, lng } = v;
  if ((lat == null || lng == null) && v.address) {
    const g = await geocode(v.address).catch(() => null);
    if (g) ({ lat, lng } = g);
  }
  const { data, error } = await supabase.from("venues").insert({
    name, slug: slug || `venue-${Date.now()}`, address: v.address, lat, lng,
    website: v.website ?? null, source: v.source, active: false,
  }).select("id").single();
  if (error || !data) throw new Error(`Couldn't save the venue: ${error?.message}`);
  return data.id;
}
