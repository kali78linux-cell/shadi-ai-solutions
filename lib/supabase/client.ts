import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'invalid-anon-key';

export const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});
