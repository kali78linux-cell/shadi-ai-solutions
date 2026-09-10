import { describe, it, expect, vi, beforeEach } from 'vitest';

// STEP 15C — entitlements core unit tests: status policy, limits extraction,
// catalog-first resolution, atomic gate (rpc), fail-open infra, release, 402.

const mockDb = vi.hoisted(() => {
  const billingChain: any = {};
  billingChain.select = vi.fn(() => billingChain);
  billingChain.eq = vi.fn(() => billingChain);
  billingChain.limit = vi.fn(() => billingChain);
  billingChain.maybeSingle = vi.fn(() => ({ data: null, error: null }));

  const subsChain: any = {};
  subsChain.select = vi.fn(() => subsChain);
  subsChain.eq = vi.fn(() => subsChain);
  subsChain.is = vi.fn(() => subsChain);
  subsChain.order = vi.fn(() => subsChain);
  subsChain.limit = vi.fn(() => subsChain);
  subsChain.maybeSingle = vi.fn(() => ({ data: null, error: null }));

  const usageChain: any = {};
  usageChain.select = vi.fn(() => usageChain);
  usageChain.eq = vi.fn(() => usageChain);

  return {
    from: vi.fn((table: string) =>
      table === 'billing_plans' ? billingChain : table === 'subscriptions' ? subsChain : usageChain
    ),
    rpc: vi.fn(async () => ({ data: {}, error: null })),
    __billing: billingChain,
    __subs: subsChain,
    __usage: usageChain,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  STARTER_LIMITS,
  effectivePlanIdFor,
  extractLimit,
  isEntitlementResource,
  assertEntitlement,
  releaseEntitlement,
  withEntitlement,
  EntitlementLimitError,
  entitlementErrorResponse,
} from '@/lib/subscription/entitlements';

const CID = '11111111-1111-1111-1111-111111111111';

describe('15C — status policy (approved decisions)', () => {
  it.each([
    ['active → plan limits', { plan_id: 'growth', status: 'active', trial_end: null }, 'growth', false],
    // STEP 15G-A — approved trial mapping: 'trialing' (DB enum) during the window → free_trial limits.
    [
      'trialing inside window → free_trial limits',
      { plan_id: 'growth', status: 'trialing', trial_end: new Date(Date.now() + 86400000).toISOString() },
      'free_trial',
      false,
    ],
    [
      'trialing expired → starter (soft downgrade)',
      { plan_id: 'growth', status: 'trialing', trial_end: new Date(Date.now() - 86400000).toISOString() },
      'starter',
      true,
    ],
    [
      'legacy free_trial status inside window → free_trial limits',
      { plan_id: 'free_trial', status: 'free_trial', trial_end: new Date(Date.now() + 86400000).toISOString() },
      'free_trial',
      false,
    ],
    [
      'trialing with no trial_end is treated as an active trial',
      { plan_id: 'free_trial', status: 'trialing', trial_end: null },
      'free_trial',
      false,
    ],
    ['past_due → starter', { plan_id: 'growth', status: 'past_due', trial_end: null }, 'starter', true],
    ['unpaid → starter', { plan_id: 'founding', status: 'unpaid', trial_end: null }, 'starter', true],
    ['canceled → starter', { plan_id: 'pro', status: 'canceled', trial_end: null }, 'starter', true],
    ['no row → starter safe default', null, 'starter', false],
    ['no plan_id → starter', { plan_id: null, status: 'active', trial_end: null }, 'starter', false],
  ])('%s', (_name, row, expectedPlan, degraded) => {
    expect(effectivePlanIdFor(row as any)).toEqual({ planId: expectedPlan, degraded });
  });
});

describe('15C — limit extraction (canonical keys only)', () => {
  it('extracts numeric limits and floors them', () => {
    expect(extractLimit({ ai_messages: 100.9 }, 'ai_messages')).toBe(100);
  });
  it('treats 0 as a hard block limit (configured)', () => {
    expect(extractLimit({ bookings: 0 }, 'bookings')).toBe(0);
  });
  it('returns undefined for missing/non-canonical/invalid entries', () => {
    expect(extractLimit({ max_patients: 50 }, 'patients')).toBeUndefined();
    expect(extractLimit({ users: -3 }, 'users')).toBeUndefined();
    expect(extractLimit(null, 'users')).toBeUndefined();
  });
  it('treats explicit null as unlimited (15G-FIX: paid-plan null != unconfigured)', () => {
    expect(extractLimit({ ai_messages: null }, 'ai_messages')).toBeNull();
    expect(extractLimit({ users: 10 }, 'users')).toBe(10);
  });
  it('starter defaults match approved decisions (patients/conversations unlimited)', () => {
    expect(STARTER_LIMITS).toEqual({
      ai_messages: 100,
      bookings: 50,
      patients: null,
      providers: 2,
      users: 2,
      knowledge_docs: 3,
      conversations: null,
    });
  });
  it('validates resource names', () => {
    expect(isEntitlementResource('ai_messages')).toBe(true);
    expect(isEntitlementResource('nope')).toBe(false);
  });
});

describe('15C — catalog-first limit resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.__billing.maybeSingle.mockImplementation(() => ({ data: null, error: null }));
    mockDb.__subs.maybeSingle.mockImplementation(() => ({ data: null, error: null }));
  });

  it('uses billing_plans.limits when the catalog has the canonical key', async () => {
    mockDb.__subs.maybeSingle.mockImplementationOnce(() => ({
      data: { plan_id: 'growth', status: 'active', trial_end: null },
      error: null,
    }));
    mockDb.__billing.maybeSingle.mockImplementationOnce(() => ({
      data: { limits: { ai_messages: 5000 } },
      error: null,
    }));
    const { getEffectiveLimit } = await import('@/lib/subscription/entitlements');
    const state = await getEffectiveLimit(CID, 'ai_messages');
    expect(state).toEqual({ limit: 5000, planId: 'growth', status: 'active', degraded: false });
    expect(mockDb.from).toHaveBeenCalledWith('billing_plans');
  });

  it('falls back to STARTER_LIMITS when the catalog lacks the key / table missing', async () => {
    mockDb.__billing.maybeSingle.mockImplementation(() => ({ data: null, error: null }));
    const { getEffectiveLimit } = await import('@/lib/subscription/entitlements');
    const state = await getEffectiveLimit(CID, 'users');
    expect(state.limit).toBe(STARTER_LIMITS.users);
  });
});

describe('15C — atomic gate (rpc check_and_increment)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.__subs.maybeSingle.mockImplementation(() => ({
      data: { plan_id: 'growth', status: 'active', trial_end: null },
      error: null,
    }));
    mockDb.__billing.maybeSingle.mockImplementation(() => ({
      data: { limits: { ai_messages: 2 } },
      error: null,
    }));
  });

  it('blocks with EntitlementLimitError when rpc reports not allowed (no throw to caller route)', async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: { allowed: false, used: 2, limit: 2 }, error: null });
    await expect(assertEntitlement(CID, 'ai_messages')).rejects.toBeInstanceOf(EntitlementLimitError);
  });

  it('allows and returns usage when rpc allows', async () => {
    mockDb.rpc.mockResolvedValueOnce({ data: { allowed: true, used: 1, limit: 2 }, error: null });
    const r = await assertEntitlement(CID, 'ai_messages');
    expect(r.allowed).toBe(true);
    expect(r.used).toBe(1);
  });

  it('fails OPEN when the rpc/infra errors (approved policy, never block clinics)', async () => {
    mockDb.rpc.mockRejectedValueOnce(new Error('db down'));
    const r = await assertEntitlement(CID, 'ai_messages');
    expect(r.allowed).toBe(true);
  });

  it('withEntitlement releases the counter when the guarded write throws', async () => {
    mockDb.rpc.mockResolvedValue({ data: { allowed: true, used: 1, limit: 2 }, error: null });
    await expect(
      withEntitlement(CID, 'ai_messages', async () => {
        throw new Error('insert failed');
      })
    ).rejects.toThrow('insert failed');
    // releaseEntitlement calls rpc with a negative increment
    expect(mockDb.rpc).toHaveBeenLastCalledWith(
      'check_and_increment_entitlement',
      expect.objectContaining({ p_increment: -1, p_limit: null })
    );
  });

  it('releaseEntitlement is best-effort (swallows rpc errors)', async () => {
    mockDb.rpc.mockRejectedValueOnce(new Error('db down'));
    await expect(releaseEntitlement(CID, 'ai_messages')).resolves.toBeUndefined();
  });
});

describe('15C — 402 mapping', () => {
  it('maps EntitlementLimitError to 402 without internals', async () => {
    const res = entitlementErrorResponse(new EntitlementLimitError('users', 2, 2))!;
    expect(res.status).toBe(402);
    expect(await res.text()).toBe(
      JSON.stringify({
        error: 'ENTITLEMENT_LIMIT_REACHED',
        resource: 'users',
        upgrade_required: true,
      })
    );
  });
  it('returns null for unrelated errors', () => {
    expect(entitlementErrorResponse(new Error('x'))).toBeNull();
  });
});