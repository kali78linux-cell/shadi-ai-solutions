import { useEffect, useState } from 'react';

type SupabaseConfigState = {
  isConfigured: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  loading: boolean;
};

/**
 * Runtime health-check for Supabase client config.
 * Always fetches from the server `/api/supabase-config` so the result reflects
 * live server env (NEXT_PUBLIC_* + service role) — never a stale client bundle.
 * service-role is NOT exposed here; the route only returns booleans + public url.
 */
export function useSupabaseConfig(): SupabaseConfigState {
  const [config, setConfig] = useState<SupabaseConfigState>({
    isConfigured: false,
    supabaseUrl: '',
    supabaseAnonKey: '',
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;

    async function check() {
      try {
        const res = await fetch('/api/supabase-config', { cache: 'no-store' });
        const body = await res.json();
        if (!isMounted) return;
        setConfig({
          isConfigured: Boolean(body?.isConfigured),
          supabaseUrl: body?.supabaseUrl ?? '',
          supabaseAnonKey: '',
          loading: false,
        });
      } catch {
        if (isMounted) setConfig((prev) => ({ ...prev, loading: false }));
      }
    }

    check();
    return () => { isMounted = false; };
  }, []);

  return config;
}