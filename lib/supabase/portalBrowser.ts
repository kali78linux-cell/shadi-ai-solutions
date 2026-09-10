'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnvConfig } from '@/lib/config';

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Browser-side SSR-compatible Supabase client (cookie-persisted patient session). */
export function getSupabasePortalBrowserClient() {
  if (!client) {
    const { supabaseUrl, anonKey } = getSupabaseEnvConfig();
    client = createBrowserClient(supabaseUrl!, anonKey!);
  }
  return client;
}
