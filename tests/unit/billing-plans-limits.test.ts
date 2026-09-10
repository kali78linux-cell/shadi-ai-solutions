import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// STEP 15G-FIX — the APPROVED final limits matrix + regression guards:
//   * billing_plans.limits must use canonical keys only,
//   * explicit null = unlimited (NEVER the Starter fallback for paid plans),
//   * legacy keys (max_patients / ai_messages_per_day / max_documents /
//     max_team / max_clinics) are inert and can never return,
//   * the DB-level CHECK guard exists in the migration.

const mockDb = vi.hoisted(() => {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => ({ data: null, error: null }));
  return { from: vi.fn(() => chain), __chain: chain };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  extractLimit,
  getPlanResourceLimit,
  getEntitlementState,
  STARTER_LIMITS,
  type EntitlementResource,
} from '@/lib/subscription/entitlements';

// Free-trial clinic id used across the entitlement-state checks.
const CID = '11111111-1111-1111-1111-111111111111';

// The approved owner matrix (2026-08-31) — the single source of truth for this test.
const FINAL_LIMITS: Record<string, Record<EntitlementResource, number | null>> = {
  free_trial: { ai_messages: 5, bookings: 50, patients: 5, providers: 2, users: 2, knowledge_docs: 5, conversations: null },
  starter: { ai_messages: 100, bookings: 50, patients: null, providers: 2, users: 2, knowledge_docs: 3, conversations: null },
  growth: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  founding: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  pro: { ai_messages: null, bookings: null, patients: null, providers: null, users: null, knowledge_docs: null, conversations: null },
};

const RESOURCES: EntitlementResource[] = [
  'ai_messages',
  'bookings',
  'patients',
  'providers',
  'users',
  'knowledge_docs',
  'conversations',
];

describe('15G-FIX — approved limits matrix resolves correctly (catalog-first)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(Object.keys(FINAL_LIMITS))('%s plan resolves every resource to the approved value', async (planId) => {
    mockDb.__chain.maybeSingle.mockResolvedValue({ data: { limits: FINAL_LIMITS[planId] }, error: null });
    const expected = FINAL_LIMITS[planId];
    for (const resource of RESOURCES) {
      const { limit, fromCatalog } = await getPlanResourceLimit(planId, resource);
      expect(limit).toBe(expected[resource]);
      expect(fromCatalog).toBe(true);
    }
  });

  it('explicit null is unlimited, NOT the Starter fallback (growth ai_messages = null → null, not 100)', async () => {
    mockDb.__chain.maybeSingle.mockResolvedValue({ data: { limits: FINAL_LIMITS.growth }, error: null });
    const { limit, fromCatalog } = await getPlanResourceLimit('growth', 'ai_messages');
    expect(limit).toBeNull();
    expect(fromCatalog).toBe(true);
    expect(limit).not.toBe(STARTER_LIMITS.ai_messages);
  });

  it('founding inherits growth limits exactly', () => {
    expect(FINAL_LIMITS.founding).toEqual(FINAL_LIMITS.growth);
  });
});

describe('15G-FIX — getEntitlementState reflects the approved matrix (catalog-first)', () => {
  it.each(Object.keys(FINAL_LIMITS))(
    '%s state resolves every resource to the approved value',
    async (planId) => {
      mockDb.__chain.maybeSingle
        .mockReset()
        .mockResolvedValueOnce({ data: { plan_id: planId, status: 'active', trial_end: null }, error: null })
        .mockResolvedValue({ data: { limits: FINAL_LIMITS[planId] }, error: null });

      const state = await getEntitlementState(CID);
      expect(state.planId).toBe(planId);
      expect(state.status).toBe('active');
      expect(state.degraded).toBe(false);
      for (const resource of RESOURCES) {
        expect(state.resources[resource].limit).toBe(FINAL_LIMITS[planId][resource]);
      }
    }
  );

  it('free_trial.ai_messages = 5 is the MONTHLY counter value (no daily counter introduced)', async () => {
    // Approved owner decision: value 5 lives in the existing monthly counter unit.
    // No daily counter exists and the canonical contract is unchanged in this step.
    mockDb.__chain.maybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: { plan_id: 'free_trial', status: 'trialing', trial_end: null }, error: null })
      .mockResolvedValue({ data: { limits: FINAL_LIMITS.free_trial }, error: null });
    const state = await getEntitlementState(CID);
    expect(state.resources.ai_messages.limit).toBe(5);
  });

  it('free_trial.patients = 5 is enforced while paid plans keep patients = null/unlimited', async () => {
    expect(FINAL_LIMITS.free_trial.patients).toBe(5);
    expect(FINAL_LIMITS.starter.patients).toBeNull();
    mockDb.__chain.maybeSingle
      .mockReset()
      .mockResolvedValueOnce({ data: { plan_id: 'free_trial', status: 'trialing', trial_end: null }, error: null })
      .mockResolvedValue({ data: { limits: FINAL_LIMITS.free_trial }, error: null });
    const state = await getEntitlementState(CID);
    expect(state.resources.patients.limit).toBe(5);
  });
});

describe('15G-FIX — explicit null vs absent key', () => {
  it('returns null (unlimited) when the canonical key is present and null', () => {
    expect(extractLimit({ ai_messages: null }, 'ai_messages')).toBeNull();
  });
  it('returns undefined when the key is absent', () => {
    expect(extractLimit({ ai_messages: 5 }, 'bookings')).toBeUndefined();
    expect(extractLimit({ max_patients: 50 }, 'patients')).toBeUndefined();
  });
  it('returns the number when present and valid', () => {
    expect(extractLimit({ users: 10 }, 'users')).toBe(10);
  });
});

describe('15G-FIX — regression guards', () => {
  it('STARTER_LIMITS contract is unchanged (approved)', () => {
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

  it('migration contains the DB-level guard + canonical keys only in limits values', () => {
    const migration = fs.readFileSync(
      path.resolve(__dirname, '../../db/migrations/20260836_billing_plans_limits_canonical.sql'),
      'utf8'
    );
    expect(migration).toContain('billing_plans_limits_only_canonical_keys');
    for (const r of RESOURCES) expect(migration).toContain(`'${r}'`);

    const legacyKeys = ['max_patients', 'ai_messages_per_day', 'max_documents', 'max_team', 'max_clinics'];
    const assignments = migration.match(/set limits =\s+'([^']+)'/g) ?? [];
    expect(assignments.length).toBeGreaterThanOrEqual(4); // free_trial/starter/growth+founding/pro
    for (const assign of assignments) {
      for (const legacy of legacyKeys) expect(assign.includes(legacy)).toBe(false);
    }
  });

  it('extractLimit never honors legacy keys (inert)', () => {
    const legacyLimits = { max_patients: 5, ai_messages_per_day: 5, max_team: 10, max_documents: 5, max_clinics: 3 };
    for (const resource of RESOURCES) {
      expect(extractLimit(legacyLimits, resource)).toBeUndefined();
    }
  });
});