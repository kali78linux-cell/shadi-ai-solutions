/**
 * PHASE 1A — Activity-Specific Entitlements (server-only).
 *
 * Extends the STEP 15C standard entitlements with ACTIVITY-SPECIFIC capability
 * limits for the non-clinic activities (imaging_center, dental_lab). Separation
 * of concepts (authoritative):
 *   Activity    — clinic | imaging_center | dental_lab  (lib/services/activityTypes)
 *   Capability  — an activity-specific limit dimension, canonical keys seeded by
 *                 migration 20260916 in public.activity_capabilities
 *                 (imaging_requests_limit, imaging_services_limit,
 *                  lab_cases_limit, lab_services_limit)
 *   Feature     — the standard 15C EntitlementResource (ai_messages, users, …)
 *                 which keeps using lib/subscription/entitlements.ts
 *   Plan        — billing_plans.plan_id, resolved through the approved 15C
 *                 status policy (active/trialing/past_due → effective plan)
 *   Entitlement — the resolved decision for one clinic+capability
 *   Limit       — numeric cap, or NULL = unlimited
 *   Usage       — monthly counter in entitlement_usage via the SAME atomic rpc
 *                 check_and_increment_entitlement (p_resource is free text)
 *   Role        — clinic_members.role, enforced BEFORE this gate (RBAC first)
 *   Permission  — clinicAuthorization roleDenied — untouched by this module
 *
 * Enforcement policy (approved in migration 20260916 header):
 *   - plan_activity_caps row present with numeric limit_value -> that limit
 *   - plan_activity_caps row present with NULL limit_value    -> unlimited
 *   - row ABSENT for (plan, activity, capability)             -> DENY (fail-closed)
 *   - capability unknown / not applicable to the clinic's
 *     activity_type                                           -> DENY (fail-closed)
 *   - resolution / rpc infrastructure error                   -> DENY (fail-closed)
 *     (activity-specific caps fail CLOSED; the 15C standard caps keep their
 *      approved fail-open posture — an explicit, documented asymmetry)
 *
 * Tenant isolation: every query is keyed by clinicId, which API routes only
 * pass AFTER authorizeClinicRequest succeeded. This module never derives a
 * clinic from user input beyond that authorized id.
 *
 * Never import from a client component (imports supabaseAdmin).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { effectivePlanIdFor, loadSubscriptionRow } from './entitlements';
import { ACTIVITY_TYPES, isActivityType, type ActivityType } from '../services/activityTypes';

// ─── Capability registry (mirrors activity_capabilities seed, migration 20260916) ───

export type ActivityCapabilityKey =
  | 'imaging_requests_limit'
  | 'imaging_services_limit'
  | 'lab_cases_limit'
  | 'lab_services_limit';

const ACTIVITY_CAPABILITY_KEYS: readonly ActivityCapabilityKey[] = [
  'imaging_requests_limit',
  'imaging_services_limit',
  'lab_cases_limit',
  'lab_services_limit',
];

export type ActivityCapabilityDef = {
  key: ActivityCapabilityKey;
  labelAr: string;
  labelEn: string;
  appliesTo: readonly ActivityType[];
};

export const ACTIVITY_CAPABILITY_REGISTRY: Record<ActivityCapabilityKey, ActivityCapabilityDef> = {
  imaging_requests_limit: {
    key: 'imaging_requests_limit',
    labelAr: 'حد طلبات الأشعة الشهرية',
    labelEn: 'Monthly imaging requests limit',
    appliesTo: ['imaging_center'],
  },
  imaging_services_limit: {
    key: 'imaging_services_limit',
    labelAr: 'حد خدمات الأشعة',
    labelEn: 'Imaging services catalog limit',
    appliesTo: ['imaging_center'],
  },
  lab_cases_limit: {
    key: 'lab_cases_limit',
    labelAr: 'حالات مختبر الأسنان الشهرية',
    labelEn: 'Monthly dental lab cases limit',
    appliesTo: ['dental_lab'],
  },
  lab_services_limit: {
    key: 'lab_services_limit',
    labelAr: 'حد خدمات مختبر الأسنان',
    labelEn: 'Dental lab services catalog limit',
    appliesTo: ['dental_lab'],
  },
};

export function isActivityCapabilityKey(value: unknown): value is ActivityCapabilityKey {
  return typeof value === 'string' && (ACTIVITY_CAPABILITY_KEYS as readonly string[]).includes(value);
}

/** Activity-specific capabilities that CAN apply to an activity type. */
export function capabilitiesForActivity(activityType: ActivityType): ActivityCapabilityKey[] {
  return ACTIVITY_CAPABILITY_KEYS.filter((key) =>
    ACTIVITY_CAPABILITY_REGISTRY[key].appliesTo.includes(activityType)
  );
}

/** The `clinic` activity has NO activity-specific caps — standard 15C features only. */
export function hasActivitySpecificCaps(activityType: ActivityType): boolean {
  return capabilitiesForActivity(activityType).length > 0;
}

export { ACTIVITY_TYPES, isActivityType };

// ─── Denial reasons / error type ──────────────────────────────────────────────

export type ActivityEntitlementDenialReason =
  | 'unknown_capability' // capability key not in the registry (fail-closed)
  | 'wrong_activity' // capability does not apply to the clinic's activity type
  | 'clinic_unresolvable' // clinic row missing/unreadable (fail-closed)
  | 'not_entitled' // no plan_activity_caps row for (plan, activity, capability)
  | 'limit_reached' // policy block: usage would exceed the resolved limit
  | 'infra_error'; // resolution/rpc infrastructure failure (fail-closed)

export class ActivityEntitlementError extends Error {
  readonly capabilityKey: ActivityCapabilityKey;
  readonly reason: ActivityEntitlementDenialReason;
  readonly limit: number | null;
  readonly used: number | null;
  readonly planId: string | null;
  readonly activityType: ActivityType | null;

  constructor(
    capabilityKey: ActivityCapabilityKey,
    reason: ActivityEntitlementDenialReason,
    limit: number | null = null,
    used: number | null = null,
    planId: string | null = null,
    activityType: ActivityType | null = null
  ) {
    super(`Activity entitlement denied (${reason}) for capability "${capabilityKey}"`);
    this.name = 'ActivityEntitlementError';
    this.capabilityKey = capabilityKey;
    this.reason = reason;
    this.limit = limit;
    this.used = used;
    this.planId = planId;
    this.activityType = activityType;
  }
}

/** Maps an ActivityEntitlementError to an HTTP response; null for other errors. */
export function activityEntitlementErrorResponse(err: unknown): Response | null {
  if (!(err instanceof ActivityEntitlementError)) return null;
  if (err.reason === 'limit_reached') {
    return new Response(
      JSON.stringify({
        error: 'ENTITLEMENT_LIMIT_REACHED',
        resource: err.capabilityKey,
        upgrade_required: true,
      }),
      { status: 402, headers: { 'content-type': 'application/json' } }
    );
  }
  return new Response(
    JSON.stringify({
      error: 'ACTIVITY_ENTITLEMENT_DENIED',
      reason: err.reason,
      capability: err.capabilityKey,
      upgrade_required: err.reason === 'not_entitled',
    }),
    { status: 403, headers: { 'content-type': 'application/json' } }
  );
}

// ─── Resolution (read-only, fail-closed) ──────────────────────────────────────

type CapRow = { capability_key: string; limit_value: number | null };

export type ActivityEntitlementResolution = {
  allowed: boolean;
  reason: ActivityEntitlementDenialReason | null;
  capabilityKey: ActivityCapabilityKey;
  limit: number | null;
  planId: string;
  activityType: ActivityType | null;
};

async function loadClinicActivityType(clinicId: string): Promise<ActivityType | null> {
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('activity_type')
    .eq('id', clinicId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const raw = (data as { activity_type?: unknown } | null)?.activity_type;
  return isActivityType(raw) ? raw : null;
}

async function loadPlanActivityCaps(planId: string, activityType: ActivityType): Promise<CapRow[]> {
  const { data, error } = await supabaseAdmin
    .from('plan_activity_caps')
    .select('capability_key, limit_value')
    .eq('plan_id', planId)
    .eq('activity_type', activityType);
  if (error) throw new Error(error.message);
  return (data ?? []) as CapRow[];
}

/**
 * Resolves (without counting) whether clinicId is entitled to capabilityKey
 * under its current effective plan. FAIL-CLOSED: every failure path denies.
 */
export async function resolveActivityEntitlement(
  clinicId: string,
  capabilityKey: ActivityCapabilityKey
): Promise<ActivityEntitlementResolution> {
  const deny = (reason: ActivityEntitlementDenialReason): ActivityEntitlementResolution => ({
    allowed: false,
    reason,
    capabilityKey,
    limit: null,
    planId: 'starter',
    activityType: null,
  });

  if (!isActivityCapabilityKey(capabilityKey)) return deny('unknown_capability');

  try {
    const activityType = await loadClinicActivityType(clinicId);
    if (!activityType) return deny('clinic_unresolvable');

    if (!ACTIVITY_CAPABILITY_REGISTRY[capabilityKey].appliesTo.includes(activityType)) {
      return { ...deny('wrong_activity'), activityType };
    }

    const subRow = await loadSubscriptionRow(clinicId);
    const { planId } = effectivePlanIdFor(subRow);

    const caps = await loadPlanActivityCaps(planId, activityType);
    const row = caps.find((c) => c.capability_key === capabilityKey);
    // Absent row for (plan, activity, capability) -> fail-closed deny.
    if (!row) return { ...deny('not_entitled'), planId, activityType };

    // NULL limit_value = explicit unlimited grant; a non-numeric value is invalid -> deny.
    if (row.limit_value !== null) {
      const n = Number(row.limit_value);
      if (!Number.isFinite(n) || n < 0) return { ...deny('not_entitled'), planId, activityType };
    }
    const limit = row.limit_value === null ? null : Math.max(0, Math.floor(Number(row.limit_value)));

    return { allowed: true, reason: null, capabilityKey, limit, planId, activityType };
  } catch (err) {
    logEvent('activity_entitlement_resolve_error', { clinicId, capabilityKey, error: String(err) }, 'error');
    return deny('infra_error');
  }
}

// ─── Enforcement (atomic check-and-increment via the 15C rpc) ─────────────────

type RpcResult = { allowed?: boolean; used?: number; limit?: number | null; remaining?: number | null };

async function callActivityRpc(
  clinicId: string,
  capabilityKey: ActivityCapabilityKey,
  limit: number | null,
  increment: number
): Promise<RpcResult> {
  const { data, error } = await supabaseAdmin.rpc('check_and_increment_entitlement', {
    p_clinic_id: clinicId,
    p_resource: capabilityKey, // entitlement_usage.resource is free text — activity keys are first-class citizens
    p_limit: limit,
    p_increment: increment,
  });
  if (error) throw new Error(error.message);
  return (data ?? {}) as RpcResult;
}

/**
 * Checks and increments the activity capability usage counter atomically.
 * THROWS ActivityEntitlementError on ANY denial — activity caps fail CLOSED
 * (approved policy), including infrastructure errors.
 */
export async function assertActivityEntitlement(
  clinicId: string,
  capabilityKey: ActivityCapabilityKey,
  increment = 1
): Promise<{
  allowed: true;
  limit: number | null;
  used: number | null;
  planId: string;
  activityType: ActivityType | null;
}> {
  const resolution = await resolveActivityEntitlement(clinicId, capabilityKey);
  if (!resolution.allowed) {
    throw new ActivityEntitlementError(
      capabilityKey,
      resolution.reason ?? 'not_entitled',
      resolution.limit,
      null,
      resolution.planId,
      resolution.activityType
    );
  }

  try {
    const result = await callActivityRpc(clinicId, capabilityKey, resolution.limit, increment);
    if (result.allowed === false) {
      throw new ActivityEntitlementError(
        capabilityKey,
        'limit_reached',
        result.limit ?? resolution.limit,
        result.used ?? 0,
        resolution.planId,
        resolution.activityType
      );
    }
    return {
      allowed: true,
      limit: resolution.limit,
      used: result.used ?? null,
      planId: resolution.planId,
      activityType: resolution.activityType,
    };
  } catch (err) {
    if (err instanceof ActivityEntitlementError) throw err;
    // Activity-specific caps fail CLOSED on infra errors (approved policy).
    logEvent('activity_entitlement_gate_infra_error', { clinicId, capabilityKey, error: String(err) }, 'error');
    throw new ActivityEntitlementError(
      capabilityKey,
      'infra_error',
      resolution.limit,
      null,
      resolution.planId,
      resolution.activityType
    );
  }
}

/** Compensating release after a failed guarded write (best-effort, never throws). */
export async function releaseActivityEntitlement(
  clinicId: string,
  capabilityKey: ActivityCapabilityKey,
  amount = 1
): Promise<void> {
  try {
    await callActivityRpc(clinicId, capabilityKey, null, -Math.abs(amount));
  } catch (err) {
    logEvent('activity_entitlement_release_error', { clinicId, capabilityKey, error: String(err) }, 'error');
  }
}

// ─── Usage snapshot (dashboard / subscription page) ───────────────────────────

export type ActivityCapabilityUsage = {
  capabilityKey: ActivityCapabilityKey;
  labelAr: string;
  applicable: boolean;
  entitled: boolean;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  unlimited: boolean;
};

/** Read-only per-clinic snapshot of all activity capabilities for its activity type. */
export async function getActivityEntitlementState(clinicId: string): Promise<{
  activityType: ActivityType | null;
  planId: string;
  degraded: boolean;
  capabilities: ActivityCapabilityUsage[];
}> {
  const activityType = await loadClinicActivityType(clinicId).catch(() => null);
  const subRow = await loadSubscriptionRow(clinicId).catch(() => null);
  const { planId, degraded } = effectivePlanIdFor(subRow);

  let caps: CapRow[] = [];
  if (activityType) {
    caps = await loadPlanActivityCaps(planId, activityType).catch(() => []);
  }

  const periodStart = new Date().toISOString().slice(0, 7) + '-01';
  let usedByKey: Partial<Record<ActivityCapabilityKey, number>> = {};
  if (caps.length > 0) {
    try {
      const { data, error } = await supabaseAdmin
        .from('entitlement_usage')
        .select('resource, used_count')
        .eq('clinic_id', clinicId)
        .eq('period_start', periodStart);
      if (!error && data) {
        usedByKey = (data as { resource: string; used_count: number }[]).reduce(
          (acc, r) => {
            if (isActivityCapabilityKey(r.resource)) acc[r.resource] = r.used_count;
            return acc;
          },
          {} as Partial<Record<ActivityCapabilityKey, number>>
        );
      }
    } catch {
      usedByKey = {};
    }
  }

  const capabilities: ActivityCapabilityUsage[] = ACTIVITY_CAPABILITY_KEYS.map((key) => {
    const def = ACTIVITY_CAPABILITY_REGISTRY[key];
    const applicable = activityType !== null && def.appliesTo.includes(activityType);
    const row = applicable ? caps.find((c) => c.capability_key === key) : undefined;
    const entitled = row !== undefined;
    const limit =
      entitled && row!.limit_value !== null ? Math.max(0, Math.floor(Number(row!.limit_value))) : null;
    const used = entitled ? usedByKey[key] ?? 0 : null;
    return {
      capabilityKey: key,
      labelAr: def.labelAr,
      applicable,
      entitled,
      limit,
      used,
      remaining: entitled && limit !== null ? Math.max(0, limit - (used ?? 0)) : null,
      unlimited: entitled && limit === null,
    };
  });

  return { activityType, planId, degraded, capabilities };
}

/**
 * Gate wrapper: RBAC has already run (route-level); check+increment the
 * activity capability, run the guarded write, release on failure.
 *   await withActivityEntitlement(clinicId, 'imaging_requests_limit', async () => { ...insert... });
 */
export async function withActivityEntitlement<T>(
  clinicId: string,
  capabilityKey: ActivityCapabilityKey,
  fn: () => Promise<T>
): Promise<T> {
  await assertActivityEntitlement(clinicId, capabilityKey);
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ActivityEntitlementError)) {
      await releaseActivityEntitlement(clinicId, capabilityKey);
    }
    throw err;
  }
}

