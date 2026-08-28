import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from '@/app/api/ai/knowledge/documents/route';

const originalEnv = process.env;

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn() }));
const mockAdmin = vi.hoisted(() => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);
vi.mock('@/lib/supabase/admin', () => mockAdmin);

describe('Knowledge documents API', () => {
  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
    vi.clearAllMocks();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  test('returns documents for the active clinic', async () => {
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockAdmin.supabaseAdmin.from.mockReturnValue(chainable);

    const response = await GET(new Request('http://localhost/api/ai/knowledge/documents?clinic_id=clinic-1'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.documents).toEqual([]);
  });
});
