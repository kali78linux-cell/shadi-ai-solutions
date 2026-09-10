import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockEntitlements = vi.hoisted(() => ({
  getEntitlementState: vi.fn(async () => ({
    planId: 'growth',
    status: 'active',
    degraded: false,
    periodStart: '2026-09-01',
    resources: {
      ai_messages: { limit: null, used: 12 },
      conversations: { limit: null, used: 4 },
    },
  })),
}));
vi.mock('@/lib/subscription/entitlements', () => mockEntitlements);

// Chainable mock mirroring the server-only service client usage.
const mockSupabaseAdmin = vi.hoisted(() => {
  const q: Record<string, any> = {};
  const chain = () => {
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      lte: vi.fn(() => builder),
      is: vi.fn(() => builder),
      then: undefined,
    };
    // Terminal await resolves with an empty result by default; tests override
    // by spying on the builder created inside the route via `from`.
    builder.resolveWith = (payload: any) => {
      builder.then = (onFulfilled: any) => Promise.resolve(onFulfilled(payload));
      return builder;
    };
    return builder;
  };
  q.__chain = chain;
  q.from = vi.fn(() => {
    const b = chain();
    // each table gets a default empty resolved builder
    b.resolveWith({ data: [], error: null, count: 0 });
    return b;
  });
  return { supabaseAdmin: q };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

import { GET } from '@/app/api/clinic/analytics/operations/route';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

function makeRequest(url: string): Request {
  return new Request(url, { headers: { authorization: 'Bearer test-token' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.roleDenied.mockReturnValue(null);
});

describe('GET /api/clinic/analytics/operations', () => {
  it('returns 400 when clinic_id is missing', async () => {
    const res = await GET(makeRequest('https://x.test/api/clinic/analytics/operations'));
    expect(res.status).toBe(400);
  });

  it('returns 403 for cross-tenant access (not a member)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await GET(makeRequest(`https://x.test/api/clinic/analytics/operations?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 401 when unauthorized', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await GET(makeRequest(`https://x.test/api/clinic/analytics/operations?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(401);
  });

  it('scopes every query to the requesting clinic (tenant isolation)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, status: 200 });
    await GET(makeRequest(`https://x.test/api/clinic/analytics/operations?clinic_id=${CLINIC_A}`));
    // 4 tables queried: appointments, conversations, providers, provider_schedules
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('appointments');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('conversations');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('providers');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('provider_schedules');
    // every eq('clinic_id', …) call used CLINIC_A, never CLINIC_B
    const eqCalls = mockSupabaseAdmin.supabaseAdmin.from.mock.results.flatMap((r: any) => r.value.eq.mock.calls);
    const clinicFilters = eqCalls.filter((c: any[]) => c[0] === 'clinic_id');
    expect(clinicFilters.length).toBeGreaterThanOrEqual(4);
    for (const call of clinicFilters) expect(call[1]).toBe(CLINIC_A);
    expect(clinicFilters.some((c: any[]) => c[1] === CLINIC_B)).toBe(false);
  });

  it('returns payload with funnel, schedule and aiUsage (null=unlimited honored)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, status: 200 });
    const res = await GET(makeRequest(`https://x.test/api/clinic/analytics/operations?clinic_id=${CLINIC_A}&from=2026-09-01T00:00:00.000Z&to=2026-09-07T23:59:59.999Z`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.period).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-07T23:59:59.999Z' });
    expect(body.data.funnel).toMatchObject({ conversations: 0, bookings: 0 });
    expect(Array.isArray(body.data.schedule)).toBe(true);
    expect(body.data.aiUsage).toEqual([
      { resource: 'ai_messages', used: 12, limit: null, remaining: null, unlimited: true },
      { resource: 'conversations', used: 4, limit: null, remaining: null, unlimited: true },
    ]);
    expect(mockEntitlements.getEntitlementState).toHaveBeenCalledWith(CLINIC_A);
  });

  it('returns 500 with a safe message when a query fails', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, status: 200 });
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementationOnce(() => {
      const b = mockSupabaseAdmin.supabaseAdmin.__chain();
      b.resolveWith({ data: null, error: { message: 'boom' }, count: 0 });
      return b;
    });
    const res = await GET(makeRequest(`https://x.test/api/clinic/analytics/operations?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('appointments');
  });
});
