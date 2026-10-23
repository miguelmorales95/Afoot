// Local test data: serve the feed from a CSV file instead of Supabase.
// Set LOCAL_EVENTS_FILE=data/events.csv in .env.local. Takes priority over demo
// mode, so a hand-curated or researched list of real events can be tested end to
// end before anything is written to the database. `npm run import:csv` later
// loads the same file into Supabase.
//
// Columns (header row required): title, description, category, price,
// starts_at, ends_at, is_recurring, recurrence_description, tags (";"-separated),
// venue_name, venue_address, neighborhood, venue_lat, venue_lng, url,
// source_url, confidence, notes. Rows without venue_lat/venue_lng are skipped;
// fill them with `npm run geocode:csv`.

import fs from "node:fs";
import path from "node:path";
import type { EventCategory, NearbyEvent, UncertainField } from "./types";

/**
 * Which details of a researched row still need confirming, read from its confidence
 * and notes ("start time conflicts", "no year on the page", "ZIP added by hand").
 */
export function uncertainFields(r: CsvRow): UncertainField[] {
  if (r.confidence === "high") return [];
  const notes = (r.notes || "").toLowerCase();
  const fields = new Set<UncertainField>();
  if (/time|start|hour|doors|8am|10am/.test(notes)) fields.add("starts_at");
  if (/address|zip|location|plaza|pin|street/.test(notes)) fields.add("address");
  if (/price|cost|ticket/.test(notes)) fields.add("price");
  if (/year|date|recurr|weekly|monthly|last friday|undated/.test(notes) || fields.size === 0) fields.add("date");
  return [...fields];
}

export type CsvRow = Record<string, string>;

export function localEventsPath(): string | null {
  const file = process.env.LOCAL_EVENTS_FILE;
  return file ? path.resolve(process.cwd(), file) : null;
}

export function hasLocalEvents(): boolean {
  const file = localEventsPath();
  return !!file && fs.existsSync(file);
}

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string): CsvRow[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { record.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field); field = "";
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
    } else field += c;
  }
  record.push(field);
  if (record.some((f) => f !== "")) records.push(record);

  const [header, ...rows] = records;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function toCsv(rows: CsvRow[], columns: string[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c] ?? "")).join(","))].join("\n") + "\n";
}

export function readLocalRows(): CsvRow[] {
  const file = localEventsPath();
  if (!file || !fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

const CATEGORIES: EventCategory[] = ["music", "karaoke", "trivia", "games", "comedy", "market", "food", "class", "other"];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

/** Same shape and ordering contract as the `nearby_events` RPC. */
export function localNearby(lat: number, lng: number, radiusKm: number, daysAhead: number): NearbyEvent[] {
  const now = Date.now();
  const until = now + daysAhead * 86_400_000;
  const events: NearbyEvent[] = [];

  for (const r of readLocalRows()) {
    const vLat = parseFloat(r.venue_lat);
    const vLng = parseFloat(r.venue_lng);
    const start = Date.parse(r.starts_at);
    if (!r.title || Number.isNaN(vLat) || Number.isNaN(vLng) || Number.isNaN(start)) continue;
    // Keep events that are still running (or started within the last 3 hours).
    const end = r.ends_at ? Date.parse(r.ends_at) : start + 3 * 3_600_000;
    if (end < now || start > until) continue;
    const distance = haversineKm(lat, lng, vLat, vLng);
    if (distance > radiusKm) continue;

    const venueId = `local-${slugify(r.venue_name)}`;
    const eventId = `${venueId}:${slugify(r.title)}`;
    const category = CATEGORIES.includes(r.category as EventCategory) ? (r.category as EventCategory) : "other";
    events.push({
      occurrence_id: `${eventId}@${r.starts_at}`,
      event_id: eventId,
      title: r.title,
      description: r.description || null,
      category,
      price: r.price || null,
      url: r.url || r.source_url || null,
      recurrence_description: r.recurrence_description || null,
      is_recurring: r.is_recurring === "true",
      tags: r.tags ? r.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
      starts_at: new Date(start).toISOString(),
      ends_at: r.ends_at ? new Date(Date.parse(r.ends_at)).toISOString() : null,
      venue_id: venueId,
      venue_name: r.venue_name,
      venue_address: r.venue_address || null,
      venue_lat: vLat,
      venue_lng: vLng,
      distance_km: Math.round(distance * 100) / 100,
      confidence: (["high", "medium", "low"].includes(r.confidence) ? r.confidence : "high") as NearbyEvent["confidence"],
      uncertain_fields: uncertainFields(r),
      cancelled: false,
      heads_up: {},
    });
  }

  return events.sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.distance_km - b.distance_km);
}
