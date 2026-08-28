import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/payments/checkout/route';

// The checkout route requires authorization + no Stripe key, so we verify:
// 1) free/trial plans are rejected (no payment), 2) paid plan returns 503 not
// configured, 3) invalid plan returns 400.

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn(), roleDenied: vi.fn(() => null), ADMIN_ROLES: ['owner','manager'], DATA_ROLES: ['owner','manager','doctor','receptionist','staff'] }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const CID = '11111111-1111-1111-1111-111111111111';

function makeReq(body: unknown) {
  return new Request(`http://localhost/api/payments/checkout?clinic_id=${CID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Checkout API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = '';
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  });

  it('rejects a free plan (no payment)', async () => {
    const res = await POST(makeReq({ plan_id: 'free_trial' }));
    expect(res.status).toBe(400);
  });

  it('returns 503 PAYMENT_NOT_CONFIGURED for a paid plan with no Stripe key', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await POST(makeReq({ plan_id: 'growth' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_NOT_CONFIGURED');
  });

  it('returns 403 when not authorized', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await POST(makeReq({ plan_id: 'growth' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid plan id', async () => {
    const res = await POST(makeReq({ plan_id: 'nope' }));
    expect(res.status).toBe(400);
  });
});