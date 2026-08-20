import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from '@/app/api/ai/knowledge/documents/route';

const originalEnv = process.env;

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => undefined,
    set: () => {},
    remove: () => {},
  }),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '@supabase/ssr';

describe('Knowledge documents API', () => {
  const mockSupabaseClient = {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  };

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
    vi.clearAllMocks();
    (createServerClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabaseClient);
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  });

  test('returns documents for the active clinic', async () => {
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { clinic_id: 'clinic-1' }, error: null }),
    };
    mockSupabaseClient.from.mockReturnValue(chainable);

    const response = await GET(new Request('http://localhost/api/ai/knowledge/documents'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.documents).toEqual([]);
  });
});
