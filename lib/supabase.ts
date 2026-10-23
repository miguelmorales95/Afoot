import { createClient, SupabaseClient as BaseClient } from "@supabase/supabase-js";

// Untyped client bound to the `afoot` schema.
type SupabaseClient = BaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Server-only Supabase client using the service role key.
// NEVER import this into a client component — the service role key bypasses
// row-level security. All DB access happens in route handlers / scripts.
//
// The client is created lazily so the app can run in DEMO_MODE (sample data,
// no DB) without these env vars set. The error only fires if you actually
// touch the database without configuring it.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hasSupabase = Boolean(url && serviceKey);

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!url || !serviceKey) {
      throw new Error(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
          "SUPABASE_SERVICE_ROLE_KEY (see .env.example), or run in DEMO_MODE.",
      );
    }
    // Afoot's tables live in their own schema; other apps share this Supabase project.
    _client = createClient(url, serviceKey, { auth: { persistSession: false }, db: { schema: "afoot" } });
  }
  return _client;
}

// Backwards-compatible handle: `supabase.from(...)`, `supabase.rpc(...)`, etc.
// resolve the real client on first property access.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabase() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
