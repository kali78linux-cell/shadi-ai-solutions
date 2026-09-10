/**
 * PP-7 — Growth / Retention & Engagement (deterministic, read-only; 2026-09-02).
 *
 * Scope: clinic-facing growth & retention intelligence — patient retention and
 * reactivation KPIs, recall performance, no-show intelligence, engagement
 * funnel (conversations → bookings), waitlist conversion, and a GUIDANCE-ONLY
 * composite Clinic Growth Score with informational recommendations.
 * OUT OF SCOPE (hard): autonomous actions (messages/recalls/payments) ·
 * AI conversation layer · patient-facing views · forecasting that invents
 * facts · any DB write.
 *
 * All outputs are DERIVED at read time from the existing source of truth:
 *   patients · appointments · conversations · clinic_recalls ·
 *   clinic_waitlist_entries (Growth Layer tables, AS-IS).
 * ZERO migrations. ZERO writes. Same input → same output (deterministic).
 *
 * Definitions (documented, honest about limits):
 *  - History window: completed appointments are read for the range plus a
 *    look-back of (INACTIVITY_MONTHS + REACTIVATION_GAP_MONTHS) months before
 *    `from`. "First visit" / "previous visit" statements are scoped to this
 *    window and never claimed beyond it.
 *  - newPatients       = patients whose created_at falls inside [from, to].
 *  - activePatients    = distinct patients with >= 1 completed appointment in range.
 *  - returningPatients = active patients with >= 1 completed appointment before
 *    `from` (within the window).
 *  - reactivated       = active patients whose latest pre-range completed visit
 *    is >= REACTIVATION_GAP_MONTHS old at `from`.
 *  - inactivePatients  = patients created before the inactivity cutoff with NO
 *    completed appointment in the last INACTIVITY_MONTHS (includes
 *    registered-but-never-completed patients — stated, not hidden).
 *  - retentionRate     = returning / active (%).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * Documented growth thresholds & score weights (guidance only, no hidden rules):
 *  - INACTIVITY_MONTHS: a patient with no completed visit in the last 6 months
 *    counts as inactive (relative to `to`).
 *  - REACTIVATION_GAP_MONTHS: a returning patient whose previous visit is at
 *    least 6 months old counts as reactivated.
 *  - REPEAT_NO_SHOW_MIN: patients with >= 2 no-shows in range are repeat offenders.
 *  - LOW_BOOKING_CONVERSION / LOW_WAITLIST_CONVERSION: recommendation triggers.
 *  - SCORE_WEIGHTS sum to 100. Components with insufficient data are excluded
 *    and the remaining weights are renormalized — the score is never guessed.
 */
export const GI_THRESHOLDS = {
  INACTIVITY_MONTHS: 6,
  REACTIVATION_GAP_MONTHS: 6,
  REPEAT_NO_SHOW_MIN: 2,
  LOW_BOOKING_CONVERSION: 0.2,
  LOW_WAITLIST_CONVERSION: 0.5,
} as const;

export const SCORE_WEIGHTS = {
  retention: 25,
  completion: 20,
  no_show_free: 20,
  recall: 15,
  booking_conversion: 20,
} as const;

const r1 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function assertDate(value?: string | null, label = 'date'): void {
  if (!value) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`INVALID_${label.toUpperCase()}`);
}

/** Add months (may clamp day overflow to month end) to a YYYY-MM-DD string. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const dim = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, dim));
  return date.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM months between two YYYY-MM-DD bounds. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = `${from.slice(0, 7)}-01`;
  const end = `${to.slice(0, 7)}-01`;
  while (cursor <= end) {
    out.push(cursor.slice(0, 7));
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** Stable ascending month sort — deterministic output for any input order. */
export function sortMonthAsc<T>(rows: T[], key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)));
}

// ---------------------------------------------------------------------------
// 1) Retention & reactivation KPIs (derived from patients + completed history)
// ---------------------------------------------------------------------------
export type PatientRow = { id: string; created_at: string };
export type CompletedVisitRow = { patient_id: string | null; appointment_date: string };

export type RetentionKpis = {
  totalPatients: number;
  newPatients: number;
  activePatients: number;
  returningPatients: number;
  reactivatedPatients: number;
  inactivePatients: number;
  completedInRange: number;
  /** returning / active (%), null when no active patients. */
  retentionRate: number | null;
  /** completed in range / active patients, null when no active patients. */
  avgVisitsPerActivePatient: number | null;
  /** mean gap (days) between consecutive completed visits, null when < 2 visits. */
  avgDaysBetweenVisits: number | null;
};

export function computeRetentionKpis(params: {
  patients: PatientRow[];
  completedHistory: CompletedVisitRow[];
  fromDate: string;
  toDate: string;
}): RetentionKpis {
  const { patients, completedHistory, fromDate, toDate } = params;
  const visits = completedHistory
    .filter((v) => v.patient_id)
    .map((v) => ({ patientId: String(v.patient_id), date: String(v.appointment_date).slice(0, 10) }));

  const inRange = visits.filter((v) => v.date >= fromDate && v.date <= toDate);
  const activeSet = new Set(inRange.map((v) => v.patientId));

  const perPatient = new Map<string, string[]>();
  for (const v of visits) {
    const list = perPatient.get(v.patientId) ?? [];
    list.push(v.date);
    perPatient.set(v.patientId, list);
  }
  for (const list of Array.from(perPatient.values())) list.sort();

  let returning = 0;
  let reactivated = 0;
  for (const patientId of Array.from(activeSet)) {
    const history = perPatient.get(patientId) ?? [];
    const before = history.filter((d) => d < fromDate);
    if (before.length === 0) continue;
    returning += 1;
    const lastBefore = before[before.length - 1];
    const cutoff = addMonths(fromDate, -GI_THRESHOLDS.REACTIVATION_GAP_MONTHS);
    if (lastBefore <= cutoff) reactivated += 1;
  }

  const inactivityCutoff = addMonths(toDate, -GI_THRESHOLDS.INACTIVITY_MONTHS);
  let inactive = 0;
  for (const p of patients) {
    const created = String(p.created_at).slice(0, 10);
    if (created >= inactivityCutoff) continue;
    const history = perPatient.get(p.id) ?? [];
    if (!history.some((d) => d >= inactivityCutoff && d <= toDate)) inactive += 1;
  }

  const gaps: number[] = [];
  for (const history of Array.from(perPatient.values())) {
    for (let i = 1; i < history.length; i += 1) {
      gaps.push((Date.parse(history[i]) - Date.parse(history[i - 1])) / 86400000);
    }
  }

  const active = activeSet.size;
  const newPatients = patients.filter((p) => {
    const created = String(p.created_at).slice(0, 10);
    return created >= fromDate && created <= toDate;
  }).length;

  return {
    totalPatients: patients.length,
    newPatients,
    activePatients: active,
    returningPatients: returning,
    reactivatedPatients: reactivated,
    inactivePatients: inactive,
    completedInRange: inRange.length,
    retentionRate: active > 0 ? r1((returning / active) * 100) : null,
    avgVisitsPerActivePatient: active > 0 ? r2(inRange.length / active) : null,
    avgDaysBetweenVisits: gaps.length > 0 ? r1(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
  };
}

// ---------------------------------------------------------------------------
// 2) Recall performance (Growth Layer clinic_recalls — AS-IS)
// ---------------------------------------------------------------------------
export type RecallRow = { status: string; due_at: string };

export type RecallPerformance = {
  total: number;
  byStatus: { open: number; notified: number; scheduled: number; dismissed: number };
  /** open/notified recalls whose due_at already passed (relative to `today`). */
  overdue: number;
  /** scheduled / (open + notified + scheduled) (%), null when no actionable recalls. */
  conversionRate: number | null;
};

export function computeRecallPerformance(recalls: RecallRow[], today: string): RecallPerformance {
  const byStatus = { open: 0, notified: 0, scheduled: 0, dismissed: 0 };
  let overdue = 0;
  for (const r of recalls) {
    const status = String(r.status ?? '');
    if (!(status in byStatus)) continue;
    byStatus[status as keyof typeof byStatus] += 1;
    if ((status === 'open' || status === 'notified') && String(r.due_at ?? '').slice(0, 10) < today) {
      overdue += 1;
    }
  }
  const actionable = byStatus.open + byStatus.notified + byStatus.scheduled;
  return {
    total: recalls.length,
    byStatus,
    overdue,
    conversionRate: actionable > 0 ? r1((byStatus.scheduled / actionable) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// 3) No-show intelligence (range appointments)
// ---------------------------------------------------------------------------
export type AppointmentRow = {
  id?: string;
  patient_id: string | null;
  status: string;
  appointment_date: string;
};

export type NoShowIntelligence = {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  noShowRate: number | null;
  cancellationRate: number | null;
  completionRate: number | null;
  /** patients with >= REPEAT_NO_SHOW_MIN no-shows in range (count desc, id asc). */
  repeatNoShowPatients: { patientId: string; count: number }[];
  monthly: { month: string; appointments: number; noShow: number; noShowRate: number | null }[];
};

const pct = (part: number, whole: number): number | null => (whole > 0 ? r1((part / whole) * 100) : null);

export function computeNoShowIntelligence(appointments: AppointmentRow[], months: string[]): NoShowIntelligence {
  const total = appointments.length;
  const count = (status: string) => appointments.filter((a) => a.status === status).length;
  const noShow = count('no_show');
  const cancelled = count('cancelled');
  const completed = count('completed');

  const noShowByPatient = new Map<string, number>();
  for (const a of appointments) {
    if (a.status === 'no_show' && a.patient_id) {
      noShowByPatient.set(String(a.patient_id), (noShowByPatient.get(String(a.patient_id)) ?? 0) + 1);
    }
  }
  const repeatNoShowPatients = Array.from(noShowByPatient.entries())
    .filter(([, c]) => c >= GI_THRESHOLDS.REPEAT_NO_SHOW_MIN)
    .map(([patientId, c]) => ({ patientId, count: c }))
    .sort((a, b) => b.count - a.count || a.patientId.localeCompare(b.patientId));

  const monthly = months.map((month) => {
    const rows = appointments.filter((a) => String(a.appointment_date).slice(0, 7) === month);
    const monthNoShow = rows.filter((a) => a.status === 'no_show').length;
    return {
      month,
      appointments: rows.length,
      noShow: monthNoShow,
      noShowRate: pct(monthNoShow, rows.length),
    };
  });

  return {
    total,
    completed,
    cancelled,
    noShow,
    noShowRate: pct(noShow, total),
    cancellationRate: pct(cancelled, total),
    completionRate: pct(completed, total),
    repeatNoShowPatients,
    monthly,
  };
}

// ---------------------------------------------------------------------------
// 4) Engagement funnel (conversations → bookings) — derived only
// ---------------------------------------------------------------------------
export type ConversationRow = { patient_id: string | null; created_at: string };

export type EngagementInsights = {
  conversations: number;
  bookings: number;
  completed: number;
  /** bookings / conversations (%), null when no conversations (no guessed rate). */
  conversationToBookingRate: number | null;
  monthly: { month: string; conversations: number; bookings: number }[];
};

export function computeEngagement(
  conversations: ConversationRow[],
  appointments: AppointmentRow[],
  months: string[],
): EngagementInsights {
  const monthly = months.map((month) => ({
    month,
    conversations: conversations.filter((c) => String(c.created_at).slice(0, 7) === month).length,
    bookings: appointments.filter((a) => String(a.appointment_date).slice(0, 7) === month).length,
  }));
  return {
    conversations: conversations.length,
    bookings: appointments.length,
    completed: appointments.filter((a) => a.status === 'completed').length,
    conversationToBookingRate:
      conversations.length > 0 ? r1((appointments.length / conversations.length) * 100) : null,
    monthly,
  };
}

// ---------------------------------------------------------------------------
// 5) Waitlist performance (Growth Layer clinic_waitlist_entries — AS-IS)
// ---------------------------------------------------------------------------
export type WaitlistPerformance = {
  total: number;
  byStatus: { active: number; notified: number; booked: number; expired: number; cancelled: number };
  /** booked / (notified + booked) (%), null when no offers were made. */
  offerConversionRate: number | null;
};

export function computeWaitlistPerformance(
  entries: { status: string }[],
): WaitlistPerformance {
  const byStatus = { active: 0, notified: 0, booked: 0, expired: 0, cancelled: 0 };
  for (const e of entries) {
    const status = String(e.status ?? '');
    if (!(status in byStatus)) continue;
    byStatus[status as keyof typeof byStatus] += 1;
  }
  const offered = byStatus.notified + byStatus.booked;
  return {
    total: entries.length,
    byStatus,
    offerConversionRate: offered > 0 ? r1((byStatus.booked / offered) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// 6) Clinic Growth Score — GUIDANCE ONLY (documented weights, renormalized
//    when a component lacks data; null when no component is derivable).
// ---------------------------------------------------------------------------
export type ScoreComponentKey = keyof typeof SCORE_WEIGHTS;

export type GrowthScore = {
  /** 0-100 guidance score, null when no component has provable data. */
  score: number | null;
  basis: 'derived' | 'insufficient_data';
  components: {
    key: ScoreComponentKey;
    label: string;
    weight: number;
    /** component value 0-100 (already normalized), null = insufficient data. */
    value: number | null;
    effectiveWeight: number;
  }[];
};

export function computeGrowthScore(inputs: {
  retentionRate: number | null;
  completionRate: number | null;
  noShowRate: number | null;
  recallConversionRate: number | null;
  conversationToBookingRate: number | null;
}): GrowthScore {
  const labels: Record<ScoreComponentKey, string> = {
    retention: 'الاحتفاظ بالمرضى',
    completion: 'إتمام المواعيد',
    no_show_free: 'خلو المواعيد من عدم الحضور',
    recall: 'تحويل الاستدعاءات',
    booking_conversion: 'تحويل المحادثات إلى حجوزات',
  };
  const values: Record<ScoreComponentKey, number | null> = {
    retention: inputs.retentionRate,
    completion: inputs.completionRate,
    no_show_free: inputs.noShowRate == null ? null : r1(100 - inputs.noShowRate),
    recall: inputs.recallConversionRate,
    booking_conversion:
      inputs.conversationToBookingRate == null
        ? null
        : r1(Math.min(100, inputs.conversationToBookingRate)),
  };

  const available = (Object.keys(SCORE_WEIGHTS) as ScoreComponentKey[]).filter(
    (k) => values[k] != null,
  );
  const totalWeight = available.reduce((s, k) => s + SCORE_WEIGHTS[k], 0);
  const score =
    available.length > 0
      ? r1(available.reduce((s, k) => s + (values[k] as number) * SCORE_WEIGHTS[k], 0) / totalWeight)
      : null;

  return {
    score,
    basis: available.length > 0 ? 'derived' : 'insufficient_data',
    components: (Object.keys(SCORE_WEIGHTS) as ScoreComponentKey[]).map((k) => ({
      key: k,
      label: labels[k],
      weight: SCORE_WEIGHTS[k],
      value: values[k],
      effectiveWeight: values[k] == null ? 0 : SCORE_WEIGHTS[k],
    })),
  };
}

// ---------------------------------------------------------------------------
// 7) Recommendations — INFORMATIONAL ONLY (no action is ever executed).
// ---------------------------------------------------------------------------
export type GrowthRecommendation = {
  code:
    | 'REACTIVATE_INACTIVE_PATIENTS'
    | 'FOLLOW_OVERDUE_RECALLS'
    | 'ADDRESS_REPEAT_NO_SHOWS'
    | 'IMPROVE_BOOKING_CONVERSION'
    | 'ENGAGE_WAITLIST';
  severity: 'high' | 'medium' | 'low';
  message: string;
};

export function buildGrowthRecommendations(inputs: {
  inactivePatients: number;
  overdueRecalls: number;
  repeatNoShowCount: number;
  conversationToBookingRate: number | null;
  waitlistOfferConversionRate: number | null;
  waitlistExpired: number;
  waitlistBooked: number;
}): GrowthRecommendation[] {
  const out: GrowthRecommendation[] = [];
  if (inputs.inactivePatients > 0) {
    out.push({
      code: 'REACTIVATE_INACTIVE_PATIENTS',
      severity: inputs.inactivePatients >= 10 ? 'high' : 'medium',
      message: `لديك ${inputs.inactivePatients} مريضًا بلا زيارة مكتملة خلال آخر ${GI_THRESHOLDS.INACTIVITY_MONTHS} أشهر — راجع قائمة المرضى الخاملين وأرسل استدعاءً وفق قواعد العيادة`,
    });
  }
  if (inputs.overdueRecalls > 0) {
    out.push({
      code: 'FOLLOW_OVERDUE_RECALLS',
      severity: 'high',
      message: `لديك ${inputs.overdueRecalls} استدعاءً متأخرًا (due date انقضى) بحالة open/notified — تابع إشعارات الاستدعاء`,
    });
  }
  if (inputs.repeatNoShowCount > 0) {
    out.push({
      code: 'ADDRESS_REPEAT_NO_SHOWS',
      severity: 'medium',
      message: `لديك ${inputs.repeatNoShowCount} مريضًا بأكثر من عدم حضور واحد في الفترة — فكّر بتأكيد إضافي قبل مواعيدهم`,
    });
  }
  if (
    inputs.conversationToBookingRate != null &&
    inputs.conversationToBookingRate < GI_THRESHOLDS.LOW_BOOKING_CONVERSION * 100
  ) {
    out.push({
      code: 'IMPROVE_BOOKING_CONVERSION',
      severity: 'medium',
      message: 'نسبة تحويل المحادثات إلى حجوزات منخفضة — راجع ردود المساعد الرقمي وتوافر المواعيد',
    });
  }
  if (
    inputs.waitlistOfferConversionRate != null &&
    inputs.waitlistOfferConversionRate < GI_THRESHOLDS.LOW_WAITLIST_CONVERSION * 100 &&
    inputs.waitlistExpired > inputs.waitlistBooked
  ) {
    out.push({
      code: 'ENGAGE_WAITLIST',
      severity: 'low',
      message: 'عدد قيود قائمة الانتظار المنتهية دون حجز أكبر من المحجوزة — راجع مطابقة قائمة الانتظار والعروض المُرسلة',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8) Aggregate report — composes every derived insight for one clinic.
//    This is the stable PP-7 interface consumed by the API/dashboard.
//    Read-only: six scoped selects, zero writes, zero migrations.
// ---------------------------------------------------------------------------
export type GrowthIntelligenceReport = {
  clinicId: string;
  range: { fromDate: string; toDate: string; historyFrom: string };
  retention: RetentionKpis;
  recalls: RecallPerformance;
  noShow: NoShowIntelligence;
  engagement: EngagementInsights;
  waitlist: WaitlistPerformance;
  growthScore: GrowthScore;
  recommendations: GrowthRecommendation[];
  meta: { generatedAt: string; deterministic: true; guidanceOnly: true; source: 'existing clinic tables only' };
};

/** Default reporting window: the last 90 days (inclusive, date-only). */
export function defaultGrowthRange(today: string): { fromDate: string; toDate: string } {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  return { fromDate: from, toDate: today };
}

/** Localized read-error wrapper — logs with event name and rethrows a clean Error. */
function growthReadError(event: string, clinicId: string, error: { message: string }): Error {
  logEvent(event, { clinic_id: clinicId, error: error.message }, 'error');
  return new Error(error.message);
}

export async function getGrowthIntelligence(
  clinicId: string,
  range: { fromDate?: string | null; toDate?: string | null; today?: string } = {},
): Promise<GrowthIntelligenceReport> {
  const today = range.today ?? new Date().toISOString().slice(0, 10);
  assertDate(today, 'today');
  assertDate(range.fromDate, 'from_date');
  assertDate(range.toDate, 'to_date');
  const fallback = defaultGrowthRange(today);
  const fromDate = range.fromDate || fallback.fromDate;
  const toDate = range.toDate || fallback.toDate;
  if (fromDate > toDate) throw new Error('INVALID_RANGE');

  // History window for retention/reactivation/visit-gap derivations.
  const historyFrom = addMonths(fromDate, -(GI_THRESHOLDS.INACTIVITY_MONTHS + GI_THRESHOLDS.REACTIVATION_GAP_MONTHS));
  const months = monthsBetween(fromDate, toDate);
  const fromIso = `${fromDate}T00:00:00.000Z`;
  const toIso = `${toDate}T23:59:59.999Z`;

  type Rows<T> = { data: T[] | null; error: { message: string } | null };
  const [patients, rangeAppointments, completedHistory, recalls, waitlistEntries, conversations] =
    await Promise.all([
      supabaseAdmin
        .from('patients')
        .select('id, created_at')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .then((r: Rows<PatientRow>) => {
          if (r.error) throw growthReadError('growth_patients_error', clinicId, r.error);
          return (r.data ?? []) as PatientRow[];
        }),
      supabaseAdmin
        .from('appointments')
        .select('patient_id, status, appointment_date')
        .eq('clinic_id', clinicId)
        .gte('appointment_date', fromDate)
        .lte('appointment_date', toDate)
        .is('deleted_at', null)
        .then((r: Rows<AppointmentRow>) => {
          if (r.error) throw growthReadError('growth_appointments_error', clinicId, r.error);
          return (r.data ?? []) as AppointmentRow[];
        }),
      supabaseAdmin
        .from('appointments')
        .select('patient_id, appointment_date')
        .eq('clinic_id', clinicId)
        .eq('status', 'completed')
        .gte('appointment_date', historyFrom)
        .lte('appointment_date', toDate)
        .is('deleted_at', null)
        .then((r: Rows<CompletedVisitRow>) => {
          if (r.error) throw growthReadError('growth_completed_history_error', clinicId, r.error);
          return (r.data ?? []) as CompletedVisitRow[];
        }),
      supabaseAdmin
        .from('clinic_recalls')
        .select('status, due_at')
        .eq('clinic_id', clinicId)
        .then((r: Rows<RecallRow>) => {
          if (r.error) throw growthReadError('growth_recalls_error', clinicId, r.error);
          return (r.data ?? []) as RecallRow[];
        }),
      supabaseAdmin
        .from('clinic_waitlist_entries')
        .select('status')
        .eq('clinic_id', clinicId)
        .then((r: Rows<{ status: string }>) => {
          if (r.error) throw growthReadError('growth_waitlist_error', clinicId, r.error);
          return (r.data ?? []) as { status: string }[];
        }),
      supabaseAdmin
        .from('conversations')
        .select('patient_id, created_at')
        .eq('clinic_id', clinicId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .is('deleted_at', null)
        .then((r: Rows<ConversationRow>) => {
          if (r.error) throw growthReadError('growth_conversations_error', clinicId, r.error);
          return (r.data ?? []) as ConversationRow[];
        }),
    ]);

  const retention = computeRetentionKpis({ patients, completedHistory, fromDate, toDate });
  const recallsPerformance = computeRecallPerformance(recalls, today);
  const noShow = computeNoShowIntelligence(rangeAppointments, months);
  const engagement = computeEngagement(conversations, rangeAppointments, months);
  const waitlist = computeWaitlistPerformance(waitlistEntries);

  const growthScore = computeGrowthScore({
    retentionRate: retention.retentionRate,
    completionRate: noShow.completionRate,
    noShowRate: noShow.noShowRate,
    recallConversionRate: recallsPerformance.conversionRate,
    conversationToBookingRate: engagement.conversationToBookingRate,
  });

  const recommendations = buildGrowthRecommendations({
    inactivePatients: retention.inactivePatients,
    overdueRecalls: recallsPerformance.overdue,
    repeatNoShowCount: noShow.repeatNoShowPatients.length,
    conversationToBookingRate: engagement.conversationToBookingRate,
    waitlistOfferConversionRate: waitlist.offerConversionRate,
    waitlistExpired: waitlist.byStatus.expired,
    waitlistBooked: waitlist.byStatus.booked,
  });

  return {
    clinicId,
    range: { fromDate, toDate, historyFrom },
    retention,
    recalls: recallsPerformance,
    noShow,
    engagement,
    waitlist,
    growthScore,
    recommendations,
    meta: {
      generatedAt: new Date().toISOString(),
      deterministic: true,
      guidanceOnly: true,
      source: 'existing clinic tables only',
    },
  };
}
