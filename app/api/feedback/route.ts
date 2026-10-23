import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";
import { hasLocalEvents } from "@/lib/localEvents";
import { HEADS_UP_REASONS, REPORT_REASONS } from "@/lib/types";

// POST /api/feedback — people's feedback on an event, no login needed:
//   { type: "report",   eventId, occurrenceId?, reason, note?, deviceId }
//   { type: "heads_up", eventId, occurrenceId?, reason, deviceId }
//   { type: "check",    eventId, occurrenceId?, field, answer: yes|no|unsure, deviceId }
// The device id is a random value the browser keeps; we store only a salted hash of it,
// never an IP. Community rules (thresholds below) act immediately; everything also lands
// in the /admin queue.

export const dynamic = "force-dynamic";

const HIDE_AFTER = 3; // distinct devices reporting scam / not_real / inappropriate
const CANCEL_AFTER = 2; // distinct devices saying a date is cancelled
const CONFIRM_AFTER = 2; // distinct "yes" answers that confirm an uncertain detail
const DAILY_LIMIT = 30; // feedback per device per day
const FIELDS = ["starts_at", "date", "address", "price"];

const salt = process.env.DEVICE_HASH_SALT || "afoot-dev-only-salt";
const hashDevice = (id: string) => createHash("sha256").update(`${salt}:${id}`).digest("hex");
const distinct = (rows: { device_hash: string }[] | null) => new Set((rows || []).map((r) => r.device_hash)).size;

export async function POST(req: NextRequest) {
  if (!hasSupabase || hasLocalEvents()) {
    return NextResponse.json({ error: "Feedback needs the database (it's off while serving events from a file)." }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const { type, eventId, occurrenceId = null, reason, field, answer, deviceId } = body ?? {};
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;

  if (typeof deviceId !== "string" || deviceId.length < 16 || typeof eventId !== "string") {
    return NextResponse.json({ error: "Missing event or device" }, { status: 400 });
  }
  const valid =
    (type === "report" && reason in REPORT_REASONS) ||
    (type === "heads_up" && reason in HEADS_UP_REASONS) ||
    (type === "check" && FIELDS.includes(field) && ["yes", "no", "unsure"].includes(answer));
  if (!valid) return NextResponse.json({ error: "Unknown feedback" }, { status: 400 });

  const device_hash = hashDevice(deviceId);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: flagsToday }, { count: checksToday }] = await Promise.all([
    supabase.from("event_flags").select("id", { count: "exact", head: true }).eq("device_hash", device_hash).gte("created_at", since),
    supabase.from("event_checks").select("id", { count: "exact", head: true }).eq("device_hash", device_hash).gte("created_at", since),
  ]);
  if ((flagsToday ?? 0) + (checksToday ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ error: "Thanks! That's a lot of feedback for one day; try again tomorrow." }, { status: 429 });
  }

  const { data: event } = await supabase.from("events").select("id, uncertain_fields").eq("id", eventId).single();
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  if (type === "check") {
    const { error } = await supabase.from("event_checks")
      .upsert({ event_id: eventId, occurrence_id: occurrenceId, field, answer, device_hash }, { onConflict: "event_id,field,device_hash" });
    if (error) return failed(error.message);

    const { data: answers } = await supabase.from("event_checks").select("answer, device_hash").eq("event_id", eventId).eq("field", field);
    const yes = distinct((answers || []).filter((a) => a.answer === "yes"));
    const no = distinct((answers || []).filter((a) => a.answer === "no"));
    if (yes >= CONFIRM_AFTER && no === 0) {
      const remaining = (event.uncertain_fields || []).filter((f: string) => f !== field);
      await supabase.from("events").update({
        uncertain_fields: remaining,
        ...(remaining.length === 0 && { confidence: "high", verified_by: "community", verified_at: new Date().toISOString() }),
      }).eq("id", eventId);
      return NextResponse.json({ ok: true, confirmed: field });
    }
    if (no >= CONFIRM_AFTER) {
      // People say this detail is wrong: put it in front of a human.
      // One system flag per event (the unique index makes repeats a no-op).
      await supabase.from("event_flags").insert(
        { event_id: eventId, kind: "report", reason: "wrong_info", note: `${no} people said the ${field.replace("_", " ")} is wrong`, device_hash: "community-check" },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase.from("event_flags")
    .insert({ event_id: eventId, occurrence_id: occurrenceId, kind: type, reason, note, device_hash });
  if (error && !/duplicate key/.test(error.message)) return failed(error.message);

  if (type === "report" && ["scam", "not_real", "inappropriate"].includes(reason)) {
    const { data } = await supabase.from("event_flags").select("device_hash")
      .eq("event_id", eventId).eq("kind", "report").in("reason", ["scam", "not_real", "inappropriate"]).neq("status", "dismissed");
    if (distinct(data) >= HIDE_AFTER) {
      await supabase.from("events").update({ status: "hidden" }).eq("id", eventId);
      return NextResponse.json({ ok: true, hidden: true });
    }
  }
  if (type === "report" && reason === "cancelled" && occurrenceId) {
    const { data } = await supabase.from("event_flags").select("device_hash")
      .eq("occurrence_id", occurrenceId).eq("reason", "cancelled").neq("status", "dismissed");
    if (distinct(data) >= CANCEL_AFTER) {
      await supabase.from("event_occurrences").update({ cancelled: true }).eq("id", occurrenceId);
      return NextResponse.json({ ok: true, cancelled: true });
    }
  }
  return NextResponse.json({ ok: true });
}

function failed(message: string) {
  console.error("feedback error:", message);
  return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 500 });
}
