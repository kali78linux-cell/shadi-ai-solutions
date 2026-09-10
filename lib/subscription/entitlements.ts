/**
 * STEP 15C — Entitlements Foundation (server-only).
 *
 * Enforces plan limits SERVER-SIDE using:
 *   - `subscriptions` (plan_id + status + trial_end) — read-only
 *   - `billing_plans.limits` (source of truth, 15B) — read-only
 *   - `entitlement_usage` + `check_and_increment_entitlement()` (15C migration,
 *     additive, atomic/race-safe via SECURITY DEFINER)
 *
 * Approved policy (owner decisions, 15C + 15G-A):
 *   active                        -> current plan limits
 *   trialing (inside trial)       -> free_trial plan limits ($ approved 15G-A:
 *                                    'trialing' with an active trial window maps
 *                                    to the free_trial plan and its limits)
 *   trialing (trial expired)      -> Starter limits (degraded)
 *   past_due / unpaid / canceled  -> Starter limits (soft downgrade)
 *   no subscription row           -> Starter limits (safe default)
 *   patients / conversations      -> NULL (unlimited) — gate stays data-driven
 *
 * Canonical limit keys (billing_plans.limits): ai_messages, bookings, patients,
 * providers, users, knowledge_docs, conversations. Legacy/none-canonical keys in
 * the 15B seed are ignored. Monthly calendar period (UTC, first day of month).
 *
 * Fail-open policy: if the entitlement infrastructure is unavailable (migration
 * not applied / rpc error), the gate ALLOWS and logs — enforcement never breaks
 * clinic operations; a "blocked" rpc result is always enforced (fail-closed on
 * policy, fail-open on infrastructure).
 *
 * Never import from a client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export type EntitlementResource =
  | 'ai_messages'
  | 'bookings'
  | 'patients'
  | 'providers'
  | 'users'
  | 'knowledge_docs'
  | 'conversations';

const ENTITLEMENT_RESOURCES: readonly EntitlementResource[] = [
  'ai_messages',
  'bookings',
  'patients',
  'providers',
  'users',
  'knowledge_docs',
  'conversations',
];

/** Arabic labels for the seven canonical entitlement resources (15G-A display). */
export const RESOURCE_LABELS_AR: Record<EntitlementResource, string> = {
  ai_messages: 'رسائل الذكاء الاصطناعي',
  bookings: 'الحجوزات',
  patients: 'المرضى',
  providers: 'الأطباء',
  users: 'أعضاء الفريق',
  knowledge_docs: 'مستندات قاعدة المعرفة',
  conversations: 'المحادثات',
};

/** Starter limits (PROJECT_STATUS §3 FREE/STARTER + 15C owner decisions). */
export const STARTER_LIMITS: Record<EntitlementResource, number | null> = {
  ai_messages: 100,
  bookings: 50,
  patients: null,
  providers: 2,
  users: 2,
  knowledge_docs: 3,
  conversations: null,
};

export function isEntitlementResource(value: unknown): value is EntitlementResource {
  return typeof value === 'string' && (ENTITLEMENT_RESOURCES as readonly string[]).includes(value);
}

type SubscriptionRow = {
  plan_id: string | null;
  status: string | null;
  trial_end: string | null;
};

/** Approved 15C/15G-A status policy → the plan whose limits apply. */
export function effectivePlanIdFor(row: SubscriptionRow | null): { planId: string; degraded: boolean } {
  if (!row || !row.plan_id) return { planId: 'starter', degraded: false };
  const status = (row.status ?? '').toLowerCase();
  if (status === 'active') return { planId: row.plan_id, degraded: false };
  // STEP 15G-A — approved trial mapping: 'trialing' (the DB enum value) — and the
  // legacy literal 'free_trial' for old rows — with an active trial window resolve
  // to the free_trial plan limits. Once the window passes the clinic lands on
  // Starter (degraded), matching the soft-downgrade policy.
  if (status === 'trialing' || status === 'free_trial') {
    const trialEnd = row.trial_end ? new Date(row.trial_end) : null;
    const trialExpired = trialEnd !== null && !Number.isNaN(trialEnd.getTime()) && trialEnd.getTime() < Date.now();
    if (trialExpired) return { planId: 'starter', degraded: true };
    return { planId: 'free_trial', degraded: false };
  }
  // past_due / unpaid / canceled / unknown → Starter limits (soft downgrade).
  return { planId: 'starter', degraded: true };
}

/**
 * Extracts a canonical numeric limit.
 *   - key absent / invalid  -> undefined (caller may fall back to Starter)
 *   - key present with null -> null  (explicit "unlimited" per the approved matrix)
 * This distinction matters: paid plans carry explicit nulls (e.g. growth
 * ai_messages) that MUST be treated as unlimited, NOT as unconfigured.
 */
export function extractLimit(limits: unknown, resource: EntitlementResource): number | null | undefined {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return undefined;
  const record = limits as Record<string, unknown>;
  if (!(resource in record)) return undefined; // absent -> not configured
  const raw = record[resource];
  if (raw === null) return null; // explicit null -> unlimited
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

/** Reads the limit for a plan from billing_plans (catalog-first), else Starter fallback. */
export async function getPlanResourceLimit(
  planId: string,
  resource: EntitlementResource
): Promise<{ limit: number | null; fromCatalog: boolean }> {
  try {
    const { data, error } = await supabaseAdmin
      .from('billing_plans')
      .select('limits')
      .eq('plan_id', planId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      const extracted = extractLimit((data as { limits?: unknown }).limits, resource);
      if (extracted !== undefined) return { limit: extracted, fromCatalog: true };
    }
  } catch {
    // fall through to Starter fallback
  }
  return { limit: STARTER_LIMITS[resource], fromCatalog: false };
}

type SubscriptionState = { limit: number | null; planId: string; status: string | null; degraded: boolean };

/** Exported for PHASE 1A activity entitlements (same subscription policy). */
export async function loadSubscriptionRow(clinicId: string): Promise<SubscriptionRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('plan_id, status, trial_end')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) return data as SubscriptionRow;
  } catch {
    // treated as no row
  }
  return null;
}

/** Effective limit for a clinic right now (subscription status + plan limits). */
export async function getEffectiveLimit(clinicId: string, resource: EntitlementResource): Promise<SubscriptionState> {
  const row = await loadSubscriptionRow(clinicId);
  const { planId, degraded } = effectivePlanIdFor(row);
  const { limit } = await getPlanResourceLimit(planId, resource);
  return { limit, planId, status: row?.status ?? null, degraded };
}

export class EntitlementLimitError extends Error {
  readonly resource: EntitlementResource;
  readonly limit: number | null;
  readonly used: number;
  readonly upgradeRequired = true as const;

  constructor(resource: EntitlementResource, limit: number | null, used: number) {
    super(`Entitlement limit reached for resource "${resource}"`);
    this.name = 'EntitlementLimitError';
    this.resource = resource;
    this.limit = limit;
    this.used = used;
  }
}

type RpcResult = { allowed?: boolean; used?: number; limit?: number | null; remaining?: number | null };

async function callRpc(clinicId: string, resource: EntitlementResource, limit: number | null, increment: number) {
  const { data, error } = await supabaseAdmin.rpc('check_and_increment_entitlement', {
    p_clinic_id: clinicId,
    p_resource: resource,
    p_limit: limit,
    p_increment: increment,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as RpcResult;
}

/**
 * Checks and increments the usage counter atomically. Throws EntitlementLimitError
 * when blocked. Infrastructure errors fail-open (logged) per the approved policy.
 */
export async function assertEntitlement(
  clinicId: string,
  resource: EntitlementResource,
  increment = 1
): Promise<{ allowed: boolean; limit: number | null; used: number | null }> {
  const { limit, planId } = await getEffectiveLimit(clinicId, resource);
  try {
    const result = await callRpc(clinicId, resource, limit, increment);
    if (result.allowed === false) {
      throw new EntitlementLimitError(resource, result.limit ?? limit, result.used ?? 0);
    }
    return { allowed: true, limit, used: result.used ?? null };
  } catch (err) {
    if (err instanceof EntitlementLimitError) throw err;
    // Infrastructure unavailable → fail-open (approved policy), never block clinics.
    logEvent('entitlement_gate_infra_error', { clinicId, resource, planId, error: String(err) });
    return { allowed: true, limit, used: null };
  }
}

/** Compensating release after a failed guarded write (failed writes are never counted). */
export async function releaseEntitlement(clinicId: string, resource: EntitlementResource, amount = 1): Promise<void> {
  try {
    await callRpc(clinicId, resource, null, -Math.abs(amount));
  } catch {
    // Best-effort; counters may over-count by `amount` until period reset.
  }
}

/**
 * Gate wrapper: check+increment, run the guarded write, release on failure.
 * Usage inside a POST handler AFTER authorization:
 *   await withEntitlement(clinicId, 'bookings', async () => { ...write... });
 */
export async function withEntitlement<T>(clinicId: string, resource: EntitlementResource, fn: () => Promise<T>): Promise<T> {
  await assertEntitlement(clinicId, resource);
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof EntitlementLimitError)) {
      await releaseEntitlement(clinicId, resource);
    }
    throw err;
  }
}

/** Current-period usage snapshot for one clinic (dashboard/subscription reporting). */
export async function getEntitlementState(clinicId: string): Promise<{
  planId: string;
  status: string | null;
  degraded: boolean;
  periodStart: string;
  resources: Record<
    EntitlementResource,
    { limit: number | null; used: number | null; fromCatalog: boolean }
  >;
}> {
  const row = await loadSubscriptionRow(clinicId);
  const { planId, degraded } = effectivePlanIdFor(row);
  const periodStart = new Date().toISOString().slice(0, 7) + '-01';

  let usedByResource: Partial<Record<EntitlementResource, number>> = {};
  try {
    const { data, error } = await supabaseAdmin
      .from('entitlement_usage')
      .select('resource, used_count')
      .eq('clinic_id', clinicId)
      .eq('period_start', periodStart);
    if (!error && data) {
      usedByResource = (data as { resource: string; used_count: number }[]).reduce(
        (acc, r) => {
          if (isEntitlementResource(r.resource)) acc[r.resource] = r.used_count;
          return acc;
        },
        {} as Partial<Record<EntitlementResource, number>>
      );
    }
  } catch {
    usedByResource = {};
  }

  const resources = {} as Record<
    EntitlementResource,
    { limit: number | null; used: number | null; fromCatalog: boolean }
  >;
  for (const resource of ENTITLEMENT_RESOURCES) {
    const { limit, fromCatalog } = await getPlanResourceLimit(planId, resource);
    resources[resource] = { limit, used: usedByResource[resource] ?? null, fromCatalog };
  }

  return { planId, status: row?.status ?? null, degraded, periodStart, resources };
}

/** Builds a 402 response for EntitlementLimitError; returns null for other errors. */
export function entitlementErrorResponse(err: unknown): Response | null {
  if (!(err instanceof EntitlementLimitError)) return null;
  return new Response(
    JSON.stringify({
      error: 'ENTITLEMENT_LIMIT_REACHED',
      resource: err.resource,
      upgrade_required: true,
    }),
    { status: 402, headers: { 'content-type': 'application/json' } }
  );
}

/** Per-resource usage snapshot ready for the dashboard (15G-A display contract). */
export type UsageSummary = {
  resource: EntitlementResource;
  labelAr: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  fromCatalog: boolean;
};

/**
 * STEP 15G-A — derives the dashboard-facing usage list from the entitlement
 * snapshot. The null/unlimited semantics are resolved HERE (server-side):
 *   - limit === null          -> unlimited: true, remaining null (never 0/fallback)
 *   - used === null (no row)  -> displayed as 0 (the counter row was never created)
 *   - numeric limit           -> used + remaining = max(0, limit - used)
 */
export function buildUsageSummary(
  resources: Record<
    EntitlementResource,
    { limit: number | null; used: number | null; fromCatalog: boolean }
  >
): UsageSummary[] {
  return ENTITLEMENT_RESOURCES.map((resource) => {
    const entry = resources[resource];
    const limit = entry.limit;
    const unlimited = limit === null;
    const used = entry.used === null ? 0 : entry.used;
    return {
      resource,
      labelAr: RESOURCE_LABELS_AR[resource],
      limit,
      used,
      remaining: unlimited ? null : Math.max(0, limit - used),
      unlimited,
      fromCatalog: entry.fromCatalog,
    };
  });
}
