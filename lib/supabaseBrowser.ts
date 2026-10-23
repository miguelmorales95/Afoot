"use client";

import { createClient, SupabaseClient as BaseClient } from "@supabase/supabase-js";

// Untyped client bound to the `afoot` schema.
type SupabaseClient = BaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Browser Supabase client for auth + user-scoped reads/writes (RLS-protected).
// Uses the public anon key — safe to ship to the client. If it's not configured
// the app runs in "demo auth" mode (simulated sign-in, local RSVPs).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasAuth = Boolean(url && anon);

export const supabaseBrowser: SupabaseClient | null = hasAuth
  ? createClient(url!, anon!, {
      db: { schema: "afoot" },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
