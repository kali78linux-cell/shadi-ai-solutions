import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/clinic/subscription/route';

// STEP 15A: the plain records endpoint must NOT be able to grant paid plans.
// Paid plans (founding/growth/pro) are only activated through Stripe Checkout.

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockDb = vi.hoisted(() => {
  const chain: any = {};
  const resolved = (data: any = null) => ({ data, error: null });
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => resolved());
  chain.single = vi.fn(() => resolved({ id: 'sub-1', plan_id: 'free_trial' }));
  chain.update = vi.fn(() => ({ eq: vi.fn(() => chain.select()) }));
  chain.insert = vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => resolved({ id: 'sub-1', plan_id: 'free_trial' })) })) }));
  return { from: vi.fn(() => chain) };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const CID = '11111111-1111-1111-1111-111111111111';

function makeReq(body: unknown) {
  return new Request(`http://localhost/api/clinic/subscription?clinic_id=${CID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Clinic subscription API — STEP 15A self-grant closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  });

  it('allows free_trial via the records endpoint', async () => {
    const res = await POST(makeReq({ plan_id: 'free_trial' }));
    expect(res.status).toBe(200);
  });

  it('allows starter (free) via the records endpoint', async () => {
    const res = await POST(makeReq({ plan_id: 'starter' }));
    expect(res.status).toBe(200);
  });

  it('rejects growth (paid) with 400 PAID_PLAN_NEEDS_CHECKOUT', async () => {
    const res = await POST(makeReq({ plan_id: 'growth' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PAID_PLAN_NEEDS_CHECKOUT');
    // Only the catalog read happened — no write to the subscriptions table.
    expect(mockDb.from).not.toHaveBeenCalledWith('subscriptions');
  });

  it('rejects pro (paid) with 400 PAID_PLAN_NEEDS_CHECKOUT', async () => {
    const res = await POST(makeReq({ plan_id: 'pro' }));
    expect(res.status).toBe(400);
  });

  it('rejects founding (paid) with 400 PAID_PLAN_NEEDS_CHECKOUT', async () => {
    const res = await POST(makeReq({ plan_id: 'founding' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid plan id', async () => {
    const res = await POST(makeReq({ plan_id: 'nope' }));
    expect(res.status).toBe(400);
  });
});