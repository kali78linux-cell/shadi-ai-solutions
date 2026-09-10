import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/clinic/subscription/route';

// STEP 15G-A — GET /api/clinic/subscription visibility contract:
//   * usage[] for all seven canonical resources (server-side, never client-built)
//   * null limit -> unlimited (never 0 / never a fallback)
//   * effective plan from entitlements.planId (trialing -> free_trial etc.)
//   * no stripe_price_id / metadata / billing_customer_id / raw limits leak
//   * cross-tenant isolation and deleted_at consistency

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockCatalog = vi.hoisted(() => ({ getPlanOrFallback: vi.fn() }));
vi.mock('@/lib/subscription/planCatalog', () => ({
  getPlanOrFallback: mockCatalog.getPlanOrFallback,
  getStripePriceIdAsync: vi.fn(async () => null),
  loadBillingPlansAll: vi.fn(async () => []),
  planRequiresPayment: vi.fn(() => false),
}));

const mockApproved = vi.hoisted(() => ({
  free_trial: { ai_messages: 5, bookings: 50, patients: 5, providers: 2, users: 2, knowledge_docs: 5, conversations: null },
  starter: { ai_messages: 100, bookings: 50, patients: null, providers: 2, users: 2, knowledge_docs: 3, conversations: null },
  growth: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  pro: { ai_messages: null, bookings: null, patients: null, providers: null, users: null, knowledge_docs: null, conversations: null },
}));

const mockDb = vi.hoisted(() => {
  const chains: Record<string, any> = {};
  const makeChain = (name: string) => {
    const resolved = () => {
      if (name === 'subscriptions') return { data: mockDb.__subRow, error: null };
      if (name === 'entitlement_usage') return { data: mockDb.__usage, error: null };
      return { data: mockDb.__limitsRow, error: null };
    };
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => resolved());
    chain.then = (res: (x: unknown) => void) => res(resolved());
    chain.catch = vi.fn();
    chains[name] = chain;
    return chain;
  };
  const db: any = {
    from: vi.fn((table: string) => {
      if (!chains[table]) makeChain(table);
      return chains[table];
    }),
    __chains: chains,
    __subRow: null as any,
    __limitsRow: null as any,
    __usage: [] as any[],
  };
  return db;
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const CID = '11111111-1111-1111-1111-111111111111';

function makeReq() {
  return new Request(`http://localhost/api/clinic/subscription?clinic_id=${CID}`, {
    headers: { authorization: 'Bearer tok' },
  });
}

function planFor(id: string) {
  return { id, name: id, nameEn: id, pricePerMonth: 0, currency: 'ils', interval: 'month', trialDays: null, priceId: null, features: [] };
}

const FUTURE = '2026-09-30T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  mockDb.__subRow = null;
  mockDb.__limitsRow = null;
  mockDb.__usage = [];
});

describe('STEP 15G-A — GET subscription visibility', () => {
  it('returns usage for all seven canonical resources with numeric limits and remaining', async () => {
    mockDb.__subRow = { plan_id: 'growth', status: 'active', billing_status: 'monthly', current_period_end: '2026-09-30T00:00:00.000Z', billing_customer_id: 'cus_secretXYZ' };
    mockDb.__limitsRow = { limits: mockApproved.growth };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('growth'));

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    const { usage, entitlements, subscription } = body.data;

    expect(usage).toHaveLength(7);
    expect(usage.map((u: any) => u.resource)).toEqual([
      'ai_messages', 'bookings', 'patients', 'providers', 'users', 'knowledge_docs', 'conversations',
    ]);
    // Numeric limit: used/remaining defaults to 0 when no counter row exists yet.
    const users = usage.find((u: any) => u.resource === 'users');
    expect(users.limit).toBe(10);
    expect(users.used).toBe(0);
    expect(users.remaining).toBe(10);
    expect(users.unlimited).toBe(false);
    expect(users.labelAr.length).toBeGreaterThan(0);

    // Effective plan comes from entitlements (server-side), not the raw plan_id.
    expect(entitlements.planId).toBe('growth');
    expect(entitlements.status).toBe('active');
    expect(entitlements.degraded).toBe(false);
    expect(entitlements.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body.data.billingPeriodLabel.length).toBeGreaterThan(0);
    expect(subscription.plan_id).toBe('growth');
  });

  it('treats a null limit as unlimited — never 0 and never a fallback', async () => {
    mockDb.__subRow = { plan_id: 'growth', status: 'active', billing_status: 'monthly', current_period_end: null };
    mockDb.__limitsRow = { limits: mockApproved.growth };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('growth'));

    const body = await (await GET(makeReq())).json();
    const ais = body.data.usage.find((u: any) => u.resource === 'ai_messages');
    expect(ais.limit).toBeNull();
    expect(ais.unlimited).toBe(true);
    expect(ais.remaining).toBeNull();
    // Never leaks the Starter fallback (100) for a paid plan.
    expect(ais.limit).not.toBe(100);
  });

  it('trialing inside the window resolves to the free_trial plan with its limits', async () => {
    mockDb.__subRow = { plan_id: 'free_trial', status: 'trialing', trial_end: FUTURE, billing_status: 'trial', current_period_end: FUTURE };
    mockDb.__limitsRow = { limits: mockApproved.free_trial };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('free_trial'));

    const body = await (await GET(makeReq())).json();
    expect(body.data.entitlements.planId).toBe('free_trial');
    expect(body.data.entitlements.degraded).toBe(false);
    const ais = body.data.usage.find((u: any) => u.resource === 'ai_messages');
    expect(ais.limit).toBe(5);
    expect(ais.unlimited).toBe(false);
  });

  it('trialing expired degrades to starter', async () => {
    mockDb.__subRow = { plan_id: 'free_trial', status: 'trialing', trial_end: PAST, billing_status: 'trial', current_period_end: PAST };
    mockDb.__limitsRow = { limits: mockApproved.starter };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('starter'));

    const body = await (await GET(makeReq())).json();
    expect(body.data.entitlements.planId).toBe('starter');
    expect(body.data.entitlements.degraded).toBe(true);
    const ais = body.data.usage.find((u: any) => u.resource === 'ai_messages');
    expect(ais.limit).toBe(100);
  });

  it('clamps remaining at 0 when usage is over the numeric limit', async () => {
    mockDb.__subRow = { plan_id: 'starter', status: 'active', billing_status: 'monthly', current_period_end: null };
    mockDb.__limitsRow = { limits: mockApproved.starter };
    mockDb.__usage = [{ resource: 'ai_messages', used_count: 150 }];
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('starter'));

    const body = await (await GET(makeReq())).json();
    const ais = body.data.usage.find((u: any) => u.resource === 'ai_messages');
    expect(ais.used).toBe(150);
    expect(ais.remaining).toBe(0);
  });

  it('never leaks stripe ids, metadata or internal subscription columns', async () => {
    mockDb.__subRow = { plan_id: 'growth', status: 'active', billing_status: 'monthly', billing_customer_id: 'cus_secretXYZ', stripe_subscription_id: 'sub_secretXYZ', current_period_end: null };
    mockDb.__limitsRow = { limits: mockApproved.growth, metadata: { internal: true } };
    mockCatalog.getPlanOrFallback.mockResolvedValue({ ...planFor('growth'), priceId: 'price_secret123' });

    const res = await GET(makeReq());
    const text = await res.text();
    expect(text).not.toContain('price_');
    expect(text).not.toContain('cus_');
    expect(text).not.toContain('sub_secretXYZ');
    expect(text).not.toContain('metadata');
    expect(text).not.toContain('billing_customer_id');
    expect(text).not.toContain('stripe_price_id');
  });

  it('rejects cross-tenant access with 403', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    // No entitlement/usage/plan queries happen for the rejected request.
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('filters soft-deleted subscription rows server-side', async () => {
    mockDb.__subRow = { plan_id: 'growth', status: 'active', billing_status: 'monthly', current_period_end: null };
    mockDb.__limitsRow = { limits: mockApproved.growth };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('growth'));

    await GET(makeReq());
    expect(mockDb.__chains.subscriptions?.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('returns a whitelisted plan without raw limits or stripe ids even on fallback', async () => {
    mockDb.__subRow = null;
    mockDb.__limitsRow = { limits: mockApproved.starter };
    mockCatalog.getPlanOrFallback.mockResolvedValue(planFor('starter'));

    const body = await (await GET(makeReq())).json();
    expect(body.data.entitlements.planId).toBe('starter'); // no subscription -> safe default starter
    const keys = Object.keys(body.data.plan);
    expect(keys).not.toContain('priceId');
    expect(keys).not.toContain('limits');
    expect(keys).not.toContain('metadata');
  });
});
