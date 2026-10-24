import type { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Admin routes need ADMIN_TOKEN (header x-admin-token, or ?token= for the review queue).
// Without one they're open only in local development; a deployed site refuses everyone
// rather than exposing the review queue and sponsors' contact details.
export function adminAuthed(req: NextRequest, { allowQuery = false } = {}): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const provided = req.headers.get("x-admin-token") || (allowQuery ? req.nextUrl.searchParams.get("token") : null) || "";
  const a = Buffer.from(provided), b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
