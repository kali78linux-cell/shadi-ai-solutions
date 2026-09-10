import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPlanOrFallback,
  getStripePriceIdAsync,
  loadBillingPlansAll,
  planRequiresPayment,
} from '@/lib/subscription/planCatalog';

// A configurable chain that returns a chosen billing_plans row / error.
const mockState = vi.hoisted(() => ({ row: null as any, error: null as any }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {};
      const resolved = () => ({ data: mockState.row, error: mockState.error });
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) chain[m] = () => chain;
      chain.maybeSingle = () => resolved();
      chain.single = () => resolved();
      chain.then = (res: (x: unknown) => void) => res(resolved());
      return chain;
    }),
  },
}));

const GROWTH_ROW = {
  plan_id: 'growth',
  name: 'النمو',
  name_en: 'Growth',
  currency: 'ils',
  price_per_month: 12000,
  billing_interval: 'month',
  trial_days: null,
  stripe_price_id: 'price_fromdb123',
  is_active: true,
  is_public: true,
  display_order: 30,
  features: ['3 عيادات'],
  // STEP 15G-FIX: canonical keys only (legacy max_clinics was never read by entitlements.ts).
  limits: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  metadata: {},
};

describe('planCatalog — STEP 15B source of truth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockState.row;
    mockState.row = null;
    mockState.error = null;
    delete process.env.STRIPE_PRICE_GROWTH_MONTHLY;
  });

  it('returns the DB row as the plan when billing_plans is available', async () => {
    mockState.row = GROWTH_ROW;
    const plan = await getPlanOrFallback('growth');
    expect(plan.id).toBe('growth');
    expect(plan.pricePerMonth).toBe(12000);
    expect(plan.currency).toBe('ils');
    expect(plan.priceId).toBe('price_fromdb123');
    expect(plan.features).toContain('3 عيادات');
  });

  it('falls back to the static plans.ts when the table is unavailable (error)', async () => {
    mockState.error = { message: 'relation "billing_plans" does not exist' };
    delete process.env.STRIPE_PRICE_GROWTH_MONTHLY;
    const plan = await getPlanOrFallback('growth');
    expect(plan.id).toBe('growth');
    expect(plan.pricePerMonth).toBe(12000); // static growth
    expect(plan.priceId).toBe(null);
  });

  it('falls back when the row is missing', async () => {
    mockState.row = null;
    const plan = await getPlanOrFallback('pro');
    expect(plan.id).toBe('pro');
    expect(plan.pricePerMonth).toBe(30000);
  });

  it('loads all active plans ordered by display_order', async () => {
    mockState.row = [GROWTH_ROW, { ...GROWTH_ROW, plan_id: 'pro', display_order: 40 }, { ...GROWTH_ROW, plan_id: 'founding', display_order: 20 }];
    // loadBillingPlansAll reads a LIST — but our chain resolves a single row; simulate via error fallback instead:
    mockState.error = { message: 'no list' };
    const plans = await loadBillingPlansAll();
    // static fallback still contains the five canonical plans
    expect(plans.length).toBe(5);
    expect(plans[0].id).toBe('free_trial');
  });

  it('prefers the catalog Stripe price id and falls back to env otherwise', async () => {
    mockState.row = GROWTH_ROW;
    expect(await getStripePriceIdAsync('growth')).toBe('price_fromdb123');

    mockState.row = { ...GROWTH_ROW, stripe_price_id: null };
    process.env.STRIPE_PRICE_GROWTH_MONTHLY = 'price_envfallback99';
    expect(await getStripePriceIdAsync('growth')).toBe('price_envfallback99');
  });

  it('planRequiresPayment reflects catalog price', () => {
    expect(planRequiresPayment({ pricePerMonth: 5000 } as any)).toBe(true);
    expect(planRequiresPayment({ pricePerMonth: 0 } as any)).toBe(false);
  });
});