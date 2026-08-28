/**
 * Services API keeps pricing_type/price_min/price_max/price_visible through
 * create→read round-trips (the old code silently stripped them), and empty
 * form strings no longer coerce to price 0 ("free").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let inserted: any = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
        insert: undefined as never,
      }),
      insert: (row: any) => ({
        select: () => ({ single: async () => { inserted = row; return { data: { id: 'svc1', ...row, deleted_at: null }, error: null }; } }),
      }),
    })),
  },
}));
vi.mock('@/lib/services/clinicAuthorization', () => ({
  authorizeClinicRequest: vi.fn(async () => ({ authorized: true, user: { id: 'u1' }, role: 'owner' })),
  roleDenied: () => null,
  ADMIN_ROLES: ['owner', 'manager'],
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { POST } from '@/app/api/clinic/services/route';

const CLINIC = '22222222-2222-2222-2222-222222222222';
function req(body: unknown) {
  return new Request(`http://localhost/api/clinic/services?clinic_id=${CLINIC}`, {
    method: 'POST', headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => { inserted = null; });

describe('services POST pricing handling', () => {
  it('stores pricing fields and mirrors fixed price into legacy column', async () => {
    const res = await POST(req({ name: 'تنظيف', duration_minutes: 30, price: 150, pricing_type: 'fixed', price_visible_to_patients: true }));
    expect(res.status).toBe(201);
    expect(inserted.pricing_type).toBe('fixed');
    expect(inserted.price).toBe(150);
    expect(inserted.price_visible_to_patients).toBe(true);
  });

  it('does NOT coerce empty price string to 0 (free)', async () => {
    const res = await POST(req({ name: 'تنظيف', duration_minutes: '30', price: '', pricing_type: 'fixed' }));
    expect(res.status).toBe(201);
    expect(inserted.price).toBeNull();
  });

  it('stores range bounds and rejects max<min', async () => {
    const okRes = await POST(req({ name: 'تقويم', duration_minutes: 45, pricing_type: 'range', price_min: 2000, price_max: 4000 }));
    expect(okRes.status).toBe(201);
    expect(inserted.price_min).toBe(2000);
    expect(inserted.price_max).toBe(4000);

    const bad = await POST(req({ name: 'تقويم', duration_minutes: 45, pricing_type: 'range', price_min: 4000, price_max: 2000 }));
    expect(bad.status).toBe(400);
  });
});
