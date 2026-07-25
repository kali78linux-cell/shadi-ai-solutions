import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnvConfig } from '@/lib/config';

const config = getSupabaseEnvConfig();

export const isSupabaseConfigured = config.isConfigured;

export const supabase = createClient(
  config.supabaseUrl || 'https://example.supabase.co',
  config.anonKey || 'invalid-anon-key',
  {
    auth: { persistSession: false },
  }
);
