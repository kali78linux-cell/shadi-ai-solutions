import { createClient } from '@supabase/supabase-js';
import { getSupabaseEnvConfig } from '@/lib/config';

const { supabaseUrl, serviceRoleKey } = getSupabaseEnvConfig();

export const supabaseAdmin = createClient(
  supabaseUrl || 'https://example.supabase.co',
  serviceRoleKey || 'invalid-service-role-key',
  {
    auth: { persistSession: false },
  }
);
