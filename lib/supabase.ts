import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnvConfig } from '@/lib/config';

const config = getSupabaseEnvConfig();

// Client-facing flag: use only public keys so the browser can detect config
// SUPABASE_SERVICE_ROLE_KEY is server-only and never inlined in client bundles.
export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.anonKey);

export const supabase = createClient(
  config.supabaseUrl || 'https://example.supabase.co',
  config.anonKey || 'invalid-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }
);
