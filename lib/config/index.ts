import type { SupabaseConfig } from '@/types/config';

// Guard access to `process` so this module can be imported on the client
const env = typeof process !== 'undefined' && process?.env ? process.env : {} as Record<string, string | undefined>;

export function getSupabaseEnvConfig(): SupabaseConfig {
  // Only public NEXT_PUBLIC_* keys are relevant on the client
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

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
  return env.SUPABASE_SETUP_TOKEN ?? null;
}

export function isValidSetupToken(token?: string): boolean {
  const setupToken = getSetupAuthToken();
  if (!setupToken) {
    return true;
  }
  return token === setupToken;
}
