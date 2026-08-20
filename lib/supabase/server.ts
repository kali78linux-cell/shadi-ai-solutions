import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnvConfig } from '@/lib/config';

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  const { supabaseUrl, anonKey } = getSupabaseEnvConfig();

  return createServerClient(
    supabaseUrl!,
    anonKey!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );
}

export const supabaseServer = new Proxy({} as object, {
  get(_target, prop) {
    const client = createSupabaseServerClient() as unknown as Record<string, unknown>;
    const value = client[prop as string];

    if (typeof value === 'function') {
      return value.bind(client);
    }

    return value;
  },
});
