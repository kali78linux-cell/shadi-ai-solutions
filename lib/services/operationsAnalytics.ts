// STEP: Operations Intelligence — Foundation
// Server-only, read-only analytics over existing tables. ZERO schema changes.
// Tenant-scoped by clinic_id (every query filters clinic_id explicitly).
// Accounting compatibility: appointment→service linkage is read via the
// `service_id` FK (never invents prices; never touches subscriptions/Stripe).
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getEntitlementState } from '@/lib/subscription/entitlements';

export type ResourceUsage = {
  resource: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
};

export type FunnelMetrics = {
  conversations: number;
  bookings: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  conversationToBookingRate: number;
  confirmationRate: number;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  serviceIdLinkedBookings: number;
  serviceIdLinkageRate: number;
};

export type ProviderScheduleMetrics = {
  providerId: string;
  name: string;
  appointments: number;
  completed: number;
  cancelled: number;
  noShow: number;
  occupiedMinutes: number;
  availableMinutes: number;
  gapMinutes: number;
  utilization: number | null; // null when the provider has no enabled schedule
};

export type OperationsAnalytics = {
  period: { from: string; to: string };
  funnel: FunnelMetrics;
  schedule: ProviderScheduleMetrics[];
  aiUsage: ResourceUsage[];
};

// Appointment statuses that reserve a real slot in the calendar.
const OCCUPYING_STATUSES = new Set(['tentative', 'scheduled', 'confirmed', 'completed']);

/** Default reporting window: the last 30 days (UTC). */
export function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Pure funnel computation over pre-fetched appointment rows + conversation count.
 * Kept pure so the math is directly unit-testable.
 */
export function computeFunnel(
  appointments: Array<{ status: string; service_id: string | null }>,
  conversationCount: number,
): FunnelMetrics {
  const total = appointments.length;
  const count = (status: string) => appointments.filter((a) => a.status === status).length;
  const completed = count('completed');
  const cancelled = count('cancelled');
  const noShow = count('no_show');
  const confirmed = count('confirmed');
  // "Reached confirmation" = currently confirmed OR already progressed beyond it.
  const reachedConfirmed = confirmed + completed;
  const serviceIdLinked = appointments.filter((a) => Boolean(a.service_id)).length;
  const rate = (num: number, den: number) => (den > 0 ? num / den : 0);
  return {
    conversations: conversationCount,
    bookings: total,
    confirmed: reachedConfirmed,
    completed,
    cancelled,
    noShow,
    conversationToBookingRate: rate(total, conversationCount),
    confirmationRate: rate(reachedConfirmed, total),
    completionRate: rate(completed, total),
    cancellationRate: rate(cancelled, total),
    noShowRate: rate(noShow, total),
    serviceIdLinkedBookings: serviceIdLinked,
    serviceIdLinkageRate: rate(serviceIdLinked, total),
  };
}

/**
 * Pure schedule-intelligence computation: occupied vs available minutes per
 * provider across the period, based on provider_schedules (weekday convention:
 * 1=Monday … 7=Sunday) and appointment durations of occupying statuses.
 * Days without an enabled schedule contribute zero available minutes.
 */
export function computeScheduleMetrics(
  appointments: Array<{
    provider_id: string | null;
    status: string;
    scheduled_at: string | null;
    duration_minutes: number | null;
  }>,
  providers: Array<{ id: string; name: string }>,
  schedules: Array<{ provider_id: string; weekday: number; enabled: boolean; start_time: string; end_time: string }>,
  fromIso: string,
  toIso: string,
): ProviderScheduleMetrics[] {
  // provider_schedules stores weekday 0=Sunday … 6=Saturday (CHECK 0..6),
  // matching JS getUTCDay() directly — no conversion needed.
  const minutesBetween = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return Math.max(0, eh * 60 + em - (sh * 60 + sm));
  };

  // Available minutes per provider per weekday.
  const availableByProviderWeekday = new Map<string, Map<number, number>>();
  for (const s of schedules) {
    if (!s.enabled) continue;
    const perDay = availableByProviderWeekday.get(s.provider_id) ?? new Map<number, number>();
    perDay.set(s.weekday, (perDay.get(s.weekday) ?? 0) + minutesBetween(s.start_time, s.end_time));
    availableByProviderWeekday.set(s.provider_id, perDay);
  }

  // Occupied minutes per provider per calendar date + status counts.
  const occupied = new Map<string, Map<string, number>>();
  const perProviderCounts = new Map<string, { appointments: number; completed: number; cancelled: number; noShow: number }>();
  for (const a of appointments) {
    if (!a.provider_id) continue;
    const stats = perProviderCounts.get(a.provider_id) ?? { appointments: 0, completed: 0, cancelled: 0, noShow: 0 };
    stats.appointments += 1;
    if (a.status === 'completed') stats.completed += 1;
    else if (a.status === 'cancelled') stats.cancelled += 1;
    else if (a.status === 'no_show') stats.noShow += 1;
    perProviderCounts.set(a.provider_id, stats);
    if (!OCCUPYING_STATUSES.has(a.status) || !a.scheduled_at) continue;
    const day = new Date(a.scheduled_at).toISOString().slice(0, 10);
    const perDay = occupied.get(a.provider_id) ?? new Map<string, number>();
    perDay.set(day, (perDay.get(day) ?? 0) + (a.duration_minutes ?? 30));
    occupied.set(a.provider_id, perDay);
  }

  // Iterate every date in the period once.
  const days: Array<{ date: string; weekday: number }> = [];
  const cursor = new Date(fromIso);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(toIso);
  end.setUTCHours(23, 59, 59, 999);
  while (cursor <= end) {
    days.push({ date: cursor.toISOString().slice(0, 10), weekday: cursor.getUTCDay() });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return providers.map((p) => {
    const perWeekday = availableByProviderWeekday.get(p.id) ?? new Map<number, number>();
    const availableMinutes = days.reduce((sum, d) => sum + (perWeekday.get(d.weekday) ?? 0), 0);
    const perDay = occupied.get(p.id) ?? new Map<string, number>();
    const occupiedMinutes = days.reduce((sum, d) => sum + (perDay.get(d.date) ?? 0), 0);
    const stats = perProviderCounts.get(p.id) ?? { appointments: 0, completed: 0, cancelled: 0, noShow: 0 };
    const hasSchedule = availableByProviderWeekday.has(p.id);
    return {
      providerId: p.id,
      name: p.name,
      ...stats,
      occupiedMinutes,
      availableMinutes,
      gapMinutes: Math.max(0, availableMinutes - occupiedMinutes),
      utilization: hasSchedule && availableMinutes > 0 ? occupiedMinutes / availableMinutes : null,
    };
  });
}


/**
 * Maps the canonical entitlement state (15C/15G-FIX) to usage rows.
 * null limit ⇒ unlimited:true and remaining:null (never 0, never fallback).
 */
export function mapAiUsage(
  resources: Record<string, { limit: number | null; used: number | null }>,
): ResourceUsage[] {
  return Object.entries(resources).map(([resource, { limit, used }]) => ({
    resource,
    used: used ?? 0,
    limit,
    remaining: limit == null ? null : Math.max(0, limit - (used ?? 0)),
    unlimited: limit == null,
  }));
}

/**
 * Aggregates the full Operations Intelligence payload for one clinic.
 * Read-only: selects only; never writes. Every query is clinic-scoped.
 */
export async function getOperationsAnalytics(
  clinicId: string,
  from?: string,
  to?: string,
): Promise<OperationsAnalytics> {
  const fallback = defaultPeriod();
  const periodFrom = from ?? fallback.from;
  const periodTo = to ?? fallback.to;

  const [appointmentsRes, conversationsRes, providersRes, schedulesRes] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('status, scheduled_at, created_at, provider_id, service_id, duration_minutes')
      .eq('clinic_id', clinicId)
      .gte('scheduled_at', periodFrom)
      .lte('scheduled_at', periodTo),
    supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .gte('created_at', periodFrom)
      .lte('created_at', periodTo),
    supabaseAdmin
      .from('providers')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('provider_schedules')
      .select('provider_id, weekday, enabled, start_time, end_time')
      .eq('clinic_id', clinicId),
  ]);

  const throwIf = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`${label}: ${error.message}`);
  };
  throwIf('appointments', appointmentsRes.error);
  throwIf('conversations', conversationsRes.error);
  throwIf('providers', providersRes.error);
  throwIf('provider_schedules', schedulesRes.error);

  const conversationCount = conversationsRes.count ?? 0;
  const appointments = appointmentsRes.data ?? [];
  const providers = providersRes.data ?? [];
  const schedules = schedulesRes.data ?? [];

  // AI usage vs plan limits (canonical keys, null = unlimited).
  const entitlements = await getEntitlementState(clinicId);

  return {
    period: { from: periodFrom, to: periodTo },
    funnel: computeFunnel(appointments, conversationCount),
    schedule: computeScheduleMetrics(appointments, providers, schedules, periodFrom, periodTo),
    aiUsage: mapAiUsage(entitlements.resources),
  };
}

