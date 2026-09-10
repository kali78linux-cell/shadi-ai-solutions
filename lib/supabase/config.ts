/**
 * SUPABASE CONFIG FLAGS — server + client safe.
 *
 * This module ONLY reads `NEXT_PUBLIC_*` env (which Next inlines into the client
 * bundle when referenced directly) and NEVER creates a Supabase client. It is the
 * single place for configuration flags so:
 *   - browser components import from `@/lib/supabase` (client) and re-use this flag,
 *   - server components / route handlers import from `@/lib/supabase/config` directly
 *     WITHOUT accidentally bundling a browser client into the server graph.
 *
 * `isSupabaseConfigured` intentionally checks ONLY url+anon key (the publishable
 * pair). The service-role key is never present in the browser, so including it
 * here would make every client render the "not configured" state falsely.
 */
export function getSupabaseCoreConfig() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  };
}

export const isSupabaseConfigured = Boolean(
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').length > 0 &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').length > 0
);