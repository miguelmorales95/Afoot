// Server-side sponsor campaigns: which are live today, and the two counters (views,
// clicks). Uses the service-role client, so never import this into a client component.
//
// Privacy: the only thing ever written is +n on (campaign, day) in campaign_daily.
// No cookies, IPs, device ids or user agents are stored (the user agent is only read
// to skip obvious bots).

import { supabase, hasSupabase } from "./supabase";
import { isDemoMode } from "./demo";
import type { CampaignProduct, CampaignStatus, LiveCampaign } from "./ads";

export interface CampaignRow extends LiveCampaign {
  sponsor_id: string;
  href: string;
  starts_on: string; // YYYY-MM-DD
  ends_on: string;
  status: CampaignStatus;
  price_cents: number | null;
  created_at: string;
  updated_at: string;
}

export const CAMPAIGN_COLUMNS =
  "id, sponsor_id, product, area, event_id, starts_on, ends_on, badge, title, body, cta, href, status, price_cents, created_at, updated_at";

/** Today's date in Los Angeles (campaign dates and daily counts use LA days). */
export function todayLA(date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

export const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Crawlers, link previewers, monitoring and scripts. Not exhaustive: it only keeps the
// obvious non-people out of the counts. A missing user agent counts as a bot.
const BOT_UA =
  /bot|crawl|spider|slurp|scrap|preview|fetch|facebookexternalhit|embedly|headless|lighthouse|pagespeed|monitor|uptime|curl|wget|python|httpclient|okhttp|java\/|go-http|node|axios|undici|postman|insomnia/i;
export const isBot = (ua: string | null): boolean => !ua || BOT_UA.test(ua);

// Live campaigns are read on every page view, so keep them in memory briefly. A paused
// campaign can keep showing for up to this long (per server instance).
const TTL_MS = 60_000;
let cache: { at: number; rows: CampaignRow[] } | null = null;

/**
 * Campaigns with status "live" whose dates include today (LA). Returns [] (so every
 * slot falls back to the network / house ads exactly as before) when there's no
 * database, in demo mode, or before the sponsor tables exist.
 */
export async function liveCampaigns(): Promise<CampaignRow[]> {
  if (!hasSupabase || isDemoMode()) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const today = todayLA();
  const { data, error } = await supabase
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("status", "live")
    .lte("starts_on", today)
    .gte("ends_on", today)
    .order("created_at", { ascending: true });
  if (error) {
    // Most likely the migration hasn't been applied yet. Cached too, so this logs at
    // most once a minute.
    console.warn("sponsor campaigns unavailable:", error.message);
  }
  cache = { at: Date.now(), rows: (data as CampaignRow[] | null) ?? [] };
  return cache.rows;
}

/** Only what a visitor's browser needs to draw the card. */
export function publicCampaign(c: CampaignRow): LiveCampaign {
  return {
    id: c.id, product: c.product as CampaignProduct, area: c.area, event_id: c.event_id,
    badge: c.badge, title: c.title, body: c.body, cta: c.cta,
  };
}

/** Atomically add to today's counts. Errors are logged, never thrown: counting must
 *  never break a redirect or a page. */
export async function bumpCampaign(id: string, views: number, clicks: number): Promise<void> {
  const { error } = await supabase.rpc("bump_campaign", { p_campaign: id, p_views: views, p_clicks: clicks });
  if (error) console.warn("bump_campaign failed:", error.message);
}
