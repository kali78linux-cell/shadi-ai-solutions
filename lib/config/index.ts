import type { SupabaseConfig } from '@/types/config';

// IMPORTANT: Next.js statically inlines `process.env.NEXT_PUBLIC_*` references
// into the client bundle ONLY when they are referenced directly (not via a
// dynamic `process.env` object lookup). We must reference them directly here
// so the browser receives the real URL + anon key.
// SUPABASE_SERVICE_ROLE_KEY is NOT NEXT_PUBLIC_*, so it is never inlined into
// the client bundle — it stays server-only.
export function getSupabaseEnvConfig(): SupabaseConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  return {
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    isConfigured: Boolean(supabaseUrl && anonKey && serviceRoleKey),
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnvConfig().isConfigured;
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = getSupabaseEnvConfig();
  if (!config.supabaseUrl || !config.anonKey || !config.serviceRoleKey) {
    throw new Error('Supabase environment variables are not fully configured. Please set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.');
  }
  return config;
}

export function getSetupAuthToken(): string | null {
  return process.env.SUPABASE_SETUP_TOKEN ?? null;
}

export function isValidSetupToken(token?: string): boolean {
  const setupToken = getSetupAuthToken();
  if (!setupToken) {
    return true;
  }
  return token === setupToken;
}
