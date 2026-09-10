/**
 * STEP 15B — Subscription Source of Truth (catalog loader).
 *
 * `public.billing_plans` (migration 20260830) is the official source of truth for
 * plan metadata (name, currency, monthly price, interval, trial, Stripe price id,
 * features, limits, metadata). The static list in `lib/subscription/plans.ts`
 * remains ONLY as a harmless fallback so nothing breaks on environments where the
 * migration has not been applied yet. The Stripe Price ID is read from the catalog
 * first, then falls back to `lib/subscription/planPrices.ts` (env) — keeping the
 * 15A server-side price resolution and webhook cross-check intact.
 *
 * Everything here is server-only (imports supabaseAdmin). Never import from a
 * client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUBSCRIPTION_PLANS, PLAN_BY_ID, getPlan, type SubscriptionPlan, type BillingInterval } from './plans';
import { getStripePriceId as getStripePriceIdFromEnv } from './planPrices';

export type BillingPlanRow = {
  plan_id: string;
  name: string;
  name_en: string;
  currency: string;
  price_per_month: number;
  billing_interval: string;
  trial_days: number | null;
  stripe_price_id: string | null;
  is_active: boolean;
  is_public: boolean;
  display_order: number;
  features: unknown;
  limits: unknown;
  metadata: unknown;
};

const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

function intervalFrom(value: string): BillingInterval {
  if (value === 'year') return 'year';
  if (value === 'trial') return 'trial';
  return 'month';
}

function rowToPlan(row: BillingPlanRow | null): SubscriptionPlan | null {
  if (!row || !row.plan_id) return null;
  const staticPlan = PLAN_BY_ID[row.plan_id];
  const features = Array.isArray(row.features) ? row.features.map(String) : (staticPlan?.features ?? []);
  return {
    id: row.plan_id,
    name: row.name ?? staticPlan?.name ?? row.plan_id,
    nameEn: row.name_en ?? staticPlan?.nameEn ?? row.plan_id,
    pricePerMonth: Number(row.price_per_month) || 0,
    currency: row.currency || staticPlan?.currency || 'ils',
    interval: intervalFrom(row.billing_interval),
    trialDays: row.trial_days ?? staticPlan?.trialDays ?? null,
    priceId: row.stripe_price_id && PRICE_ID_PATTERN.test(row.stripe_price_id) ? row.stripe_price_id : null,
    features,
  };
}

/** Returns all active catalog plans (fallback: the static list). */
export async function loadBillingPlansAll(): Promise<SubscriptionPlan[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_plans')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (error || !data || data.length === 0) return SUBSCRIPTION_PLANS;
    const mapped = (data as BillingPlanRow[]).map(rowToPlan).filter(Boolean) as SubscriptionPlan[];
    return mapped.length > 0 ? mapped : SUBSCRIPTION_PLANS;
  } catch {
    return SUBSCRIPTION_PLANS;
  }
}

/** Returns one plan from the catalog, falling back to the static definition. */
export async function getPlanOrFallback(planId: string | null | undefined): Promise<SubscriptionPlan> {
  if (!planId) return getPlan(null);
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_plans')
      .select('*')
      .eq('plan_id', planId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!error && data?.plan_id) {
      const mapped = rowToPlan(data as BillingPlanRow);
      if (mapped) return mapped;
    }
  } catch {
    // fall through to static fallback
  }
  return getPlan(planId);
}

/**
 * Resolves the real Stripe Price ID for a plan. Priority:
 *   1) billing_plans.stripe_price_id (official source of truth),
 *   2) env via lib/subscription/planPrices (15A behavior).
 * Returns null when neither is configured (checkout fails loudly, per 15A).
 */
export async function getStripePriceIdAsync(planId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_plans')
      .select('stripe_price_id, plan_id')
      .eq('plan_id', planId)
      .limit(1)
      .maybeSingle();
    const fromCatalog = data?.stripe_price_id;
    if (!error && fromCatalog && PRICE_ID_PATTERN.test(fromCatalog)) return fromCatalog;
  } catch {
    // fall through to env fallback
  }
  return getStripePriceIdFromEnv(planId);
}

/** Guards to be used by future entitlement gates; kept here for the catalog. */
export function planRequiresPayment(plan: SubscriptionPlan): boolean {
  return plan.pricePerMonth > 0;
}