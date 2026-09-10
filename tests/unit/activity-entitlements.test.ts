import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 1A — activity-specific entitlements core unit tests:
// capability registry, plan/capability mapping, limits (numeric / NULL unlimited),
// fail-closed policy (absent row / wrong activity / unknown capability / infra),
// atomic usage rpc, release, and the 402/403 response mapping.

const state = vi.hoisted(() => ({
  clinic: { data: { activity_type: 'imaging_center' }, error: null } as any,
  subscription: { data: { plan_id: 'growth', status: 'active', trial_end: null }, error: null } as any,
  caps: [] as any[],
  capsError: null as any,
  usage: [] as any[],
  rpcResult: { data: { allowed: true, used: 1, limit: 200 }, error: null } as any,
}));

const mockDb = vi.hoisted(() => {
  function listChain(getResult: () => { data: any; error: any }) {
    const chain: any = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => chain);
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.then = (res: any, rej: any) => Promise.resolve(getResult()).then(res, rej);
    return chain;
  }
  const clinics: any = listChain(() => ({ data: null, error: null }));
  clinics.maybeSingle = vi.fn(() => state.clinic);
  const subs: any = listChain(() => ({ data: null, error: null }));
  subs.maybeSingle = vi.fn(() => state.subscription);
  const caps = listChain(() => ({ data: state.caps, error: state.capsError }));
  const usage = listChain(() => ({ data: state.usage, error: null }));
  return {
    from: vi.fn((table: string) =>
      table === 'clinics' ? clinics : table === 'subscriptions' ? subs : table === 'plan_activity_caps' ? caps : usage
    ),
    rpc: vi.fn(async (...args: any[]) => state.rpcResult),
    __clinics: clinics,
    __subs: subs,
    __caps: caps,
    __usage: usage,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  ACTIVITY_CAPABILITY_REGISTRY,
  ActivityEntitlementError,
  assertActivityEntitlement,
  activityEntitlementErrorResponse,
  capabilitiesForActivity,
  getActivityEntitlementState,
  hasActivitySpecificCaps,
  releaseActivityEntitlement,
  resolveActivityEntitlement,
  withActivityEntitlement,
} from '@/lib/subscription/activityEntitlements';

const CID = '11111111-1111-1111-1111-111111111111';
const LAB_CID = '22222222-2222-2222-2222-222222222222';

const imagingCaps = [{ capability_key: 'imaging_requests_limit', limit_value: 200 }];

beforeEach(() => {
  vi.clearAllMocks();
  state.clinic = { data: { activity_type: 'imaging_center' }, error: null };
  state.subscription = { data: { plan_id: 'growth', status: 'active', trial_end: null }, error: null };
  state.caps = imagingCaps;
  state.capsError = null;
  state.usage = [];
  state.rpcResult = { data: { allowed: true, used: 1, limit: 200 }, error: null };
});

describe('PHASE 1A — capability registry (activity-specific)', () => {
  it('maps each capability to its exact activity (no generic lab)', () => {
    expect(capabilitiesForActivity('imaging_center')).toEqual(['imaging_requests_limit', 'imaging_services_limit']);
    expect(capabilitiesForActivity('dental_lab')).toEqual(['lab_cases_limit', 'lab_services_limit']);
    expect(capabilitiesForActivity('clinic')).toEqual([]);
    expect(hasActivitySpecificCaps('clinic')).toBe(false);
    expect(hasActivitySpecificCaps('imaging_center')).toBe(true);
  });

  it('registry keys mirror the migration 20260916 activity_capabilities seed', () => {
    expect(Object.keys(ACTIVITY_CAPABILITY_REGISTRY).sort()).toEqual(
      ['imaging_requests_limit', 'imaging_services_limit', 'lab_cases_limit', 'lab_services_limit'].sort()
    );
  });
});

describe('PHASE 1A — plan/capability mapping + limits (allowed path)', () => {
  it('allows and uses the plan_activity_caps limit for the effective plan', async () => {
    const r = await assertActivityEntitlement(CID, 'imaging_requests_limit');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(200);
    expect(r.planId).toBe('growth');
    expect(r.activityType).toBe('imaging_center');
    expect(mockDb.rpc).toHaveBeenCalledWith('check_and_increment_entitlement', {
      p_clinic_id: CID,
      p_resource: 'imaging_requests_limit',
      p_limit: 200,
      p_increment: 1,
    });
  });

  it('maps degraded subscriptions to starter plan caps (plan mapping)', async () => {
    state.subscription = { data: { plan_id: 'pro', status: 'past_due', trial_end: null }, error: null };
    state.caps = [{ capability_key: 'imaging_requests_limit', limit_value: 50 }];
    const r = await assertActivityEntitlement(CID, 'imaging_requests_limit');
    expect(r.planId).toBe('starter');
    expect(r.limit).toBe(50);
  });

  it('treats NULL limit_value as unlimited (still counts usage)', async () => {
    state.caps = [{ capability_key: 'imaging_requests_limit', limit_value: null }];
    const r = await assertActivityEntitlement(CID, 'imaging_requests_limit');
    expect(r.allowed).toBe(true);
    expect(r.limit).toBeNull();
    expect(mockDb.rpc).toHaveBeenCalledWith(
      'check_and_increment_entitlement',
      expect.objectContaining({ p_limit: null })
    );
  });
});

describe('PHASE 1A — fail-closed denials', () => {
  it('denies when the plan has no cap row for the capability (disabled capability)', async () => {
    state.caps = [];
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      name: 'ActivityEntitlementError',
      reason: 'not_entitled',
    });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies a wrong-activity capability (imaging cap for a clinic tenant)', async () => {
    state.clinic = { data: { activity_type: 'clinic' }, error: null };
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      reason: 'wrong_activity',
    });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies an unknown capability key (fail-closed)', async () => {
    await expect(assertActivityEntitlement(CID, 'not_a_capability' as any)).rejects.toMatchObject({
      reason: 'unknown_capability',
    });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies (fail-closed) when the caps table cannot be read (infra error)', async () => {
    state.capsError = { message: 'relation does not exist' };
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      reason: 'infra_error',
    });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies (fail-closed) when the clinic row is unreadable', async () => {
    state.clinic = { data: null, error: { message: 'db down' } };
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      reason: 'infra_error',
    });
  });

  it('denies (fail-closed) when the rpc itself fails — asymmetry vs 15C fail-open', async () => {
    state.rpcResult = { data: null, error: { message: 'rpc missing' } };
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      reason: 'infra_error',
    });
  });

  it('blocks with limit_reached when the rpc reports not allowed', async () => {
    state.rpcResult = { data: { allowed: false, used: 200, limit: 200 }, error: null };
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toBeInstanceOf(
      ActivityEntitlementError
    );
    await expect(assertActivityEntitlement(CID, 'imaging_requests_limit')).rejects.toMatchObject({
      reason: 'limit_reached',
      used: 200,
    });
  });
});

describe('PHASE 1A — usage, release, wrapper, response mapping', () => {
  it('usage snapshot reports entitled/used/remaining per capability', async () => {
    state.caps = [
      { capability_key: 'imaging_requests_limit', limit_value: 200 },
      { capability_key: 'imaging_services_limit', limit_value: null },
    ];
    state.usage = [
      { resource: 'imaging_requests_limit', used_count: 37 },
      { resource: 'imaging_services_limit', used_count: 4 },
    ];
    const s = await getActivityEntitlementState(CID);
    expect(s.activityType).toBe('imaging_center');
    expect(s.planId).toBe('growth');
    const req = s.capabilities.find((c) => c.capabilityKey === 'imaging_requests_limit')!;
    expect(req.entitled).toBe(true);
    expect(req.limit).toBe(200);
    expect(req.used).toBe(37);
    expect(req.remaining).toBe(163);
    const svc = s.capabilities.find((c) => c.capabilityKey === 'imaging_services_limit')!;
    expect(svc.unlimited).toBe(true);
    // lab capabilities are not applicable to an imaging_center
    expect(s.capabilities.find((c) => c.capabilityKey === 'lab_cases_limit')!.applicable).toBe(false);
  });

  it('releaseActivityEntitlement sends a negative increment and swallows rpc errors', async () => {
    await releaseActivityEntitlement(CID, 'imaging_requests_limit');
    expect(mockDb.rpc).toHaveBeenLastCalledWith(
      'check_and_increment_entitlement',
      expect.objectContaining({ p_increment: -1, p_limit: null })
    );
    state.rpcResult = { data: null, error: { message: 'db down' } };
    await expect(releaseActivityEntitlement(CID, 'imaging_requests_limit')).resolves.toBeUndefined();
  });

  it('withActivityEntitlement releases the counter when the guarded write throws', async () => {
    await expect(
      withActivityEntitlement(CID, 'imaging_requests_limit', async () => {
        throw new Error('insert failed');
      })
    ).rejects.toThrow('insert failed');
    expect(mockDb.rpc).toHaveBeenLastCalledWith(
      'check_and_increment_entitlement',
      expect.objectContaining({ p_increment: -1 })
    );
  });

  it('withActivityEntitlement does NOT release on an entitlement denial', async () => {
    state.caps = [];
    await expect(
      withActivityEntitlement(CID, 'imaging_requests_limit', async () => 'never')
    ).rejects.toBeInstanceOf(ActivityEntitlementError);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('maps limit_reached to 402 ENTITLEMENT_LIMIT_REACHED', async () => {
    const err = new ActivityEntitlementError('imaging_requests_limit', 'limit_reached', 200, 200);
    const res = activityEntitlementErrorResponse(err)!;
    expect(res.status).toBe(402);
    expect(await res.text()).toBe(
      JSON.stringify({
        error: 'ENTITLEMENT_LIMIT_REACHED',
        resource: 'imaging_requests_limit',
        upgrade_required: true,
      })
    );
  });

  it('maps not_entitled / wrong_activity / infra_error to 403 ACTIVITY_ENTITLEMENT_DENIED', async () => {
    for (const reason of ['not_entitled', 'wrong_activity', 'infra_error'] as const) {
      const res = activityEntitlementErrorResponse(new ActivityEntitlementError('lab_cases_limit', reason))!;
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('ACTIVITY_ENTITLEMENT_DENIED');
      expect(body.reason).toBe(reason);
      expect(body.capability).toBe('lab_cases_limit');
    }
  });

  it('returns null for unrelated errors', () => {
    expect(activityEntitlementErrorResponse(new Error('x'))).toBeNull();
  });
});

