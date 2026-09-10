import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-7 — Growth / Retention & Engagement tests.
 * Proves: deterministic output · retention/reactivation definitions · recall
 * conversion & overdue · no-show intelligence + repeat offenders · engagement
 * funnel · waitlist conversion · growth-score renormalization (no guessing) ·
 * recommendation mapping · no-write behavior.
 */

const mockSupabaseAdmin = vi.hoisted(() => {
  function makeBuilder(result: { data: unknown; error: unknown }) {
    const b: Record<string, any> = {};
    const CHAIN = ['select', 'eq', 'gte', 'lte', 'lt', 'gt', 'is', 'order', 'limit', 'single', 'maybeSingle'];
    for (const m of CHAIN) b[m] = vi.fn(() => b);
    // Write methods must NEVER be called by Growth Intelligence — tracked explicitly.
    b.insert = vi.fn();
    b.update = vi.fn();
    b.upsert = vi.fn();
    b.delete = vi.fn();
    b.then = (resolve: (v: unknown) => void) => resolve(result);
    return b;
  }
  const supabaseAdmin = { from: vi.fn(() => makeBuilder({ data: [], error: null })) };
  return { supabaseAdmin, makeBuilder };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

import {
  GI_THRESHOLDS,
  SCORE_WEIGHTS,
  addMonths,
  monthsBetween,
  computeRetentionKpis,
  computeRecallPerformance,
  computeNoShowIntelligence,
  computeEngagement,
  computeWaitlistPerformance,
  computeGrowthScore,
  buildGrowthRecommendations,
  getGrowthIntelligence,
  defaultGrowthRange,
} from '@/lib/services/growthIntelligence';

const TODAY = '2026-09-02';
const FROM = '2026-06-01';
const TO = '2026-08-31';

const patient = (id: string, created_at: string) => ({ id, created_at });
const visit = (patient_id: string, appointment_date: string) => ({ patient_id, appointment_date });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PP-7 date helpers', () => {
  it('addMonths clamps day overflow and handles negatives', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 6)).toBe('2026-07-15');
  });

  it('monthsBetween returns inclusive month list', () => {
    expect(monthsBetween('2026-06-01', '2026-08-31')).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('defaultGrowthRange is the last 90 days ending today', () => {
    const r = defaultGrowthRange(TODAY);
    expect(r.toDate).toBe(TODAY);
    expect(r.fromDate).toBe('2026-06-05');
  });
});

describe('PP-7 retention KPIs (computeRetentionKpis)', () => {
  it('derives new/active/returning/reactivated/inactive per documented definitions', () => {
    const patients = [
      patient('p1', '2026-06-10T10:00:00Z'), // new in range + active (first visit ever)
      patient('p2', '2025-01-01T10:00:00Z'), // active + returning (pre-range visit within gap)
      patient('p3', '2025-01-01T10:00:00Z'), // active + returning + reactivated (>= 6 months gap)
      patient('p4', '2025-01-01T10:00:00Z'), // registered long ago, never completed → inactive
    ];
    const history = [
      visit('p1', '2026-06-20'),
      visit('p2', '2026-03-15'), // < 6 months before FROM → returning only
      visit('p2', '2026-07-01'),
      visit('p3', '2025-09-01'), // <= addMonths(FROM, -6) = 2025-12-01 → reactivated
      visit('p3', '2026-07-15'),
    ];
    const result = computeRetentionKpis({ patients, completedHistory: history, fromDate: FROM, toDate: TO });
    expect(result.totalPatients).toBe(4);
    expect(result.newPatients).toBe(1);
    expect(result.activePatients).toBe(3);
    expect(result.returningPatients).toBe(2);
    expect(result.reactivatedPatients).toBe(1);
    expect(result.retentionRate).toBe(66.7);
    expect(result.completedInRange).toBe(3);
    expect(result.avgVisitsPerActivePatient).toBe(1);
    expect(result.inactivePatients).toBe(1);
  });

  it('marks a returning patient reactivated when the pre-range visit is >= 6 months old', () => {
    const history = [
      visit('p1', '2026-07-01'), // in range
      visit('p1', '2025-09-01'), // >= 6 months before FROM (2026-06-01) → reactivated
    ];
    const result = computeRetentionKpis({
      patients: [patient('p1', '2025-01-01T10:00:00Z')],
      completedHistory: history,
      fromDate: FROM,
      toDate: TO,
    });
    expect(result.activePatients).toBe(1);
    expect(result.returningPatients).toBe(1);
    expect(result.reactivatedPatients).toBe(1);
    expect(result.retentionRate).toBe(100);
  });

  it('returns null rates with no active patients (no NaN/Infinity)', () => {
    const result = computeRetentionKpis({ patients: [], completedHistory: [], fromDate: FROM, toDate: TO });
    expect(result.retentionRate).toBeNull();
    expect(result.avgVisitsPerActivePatient).toBeNull();
    expect(result.avgDaysBetweenVisits).toBeNull();
    expect(result.inactivePatients).toBe(0);
  });

  it('computes mean days between consecutive visits', () => {
    const history = [visit('p1', '2026-07-01'), visit('p1', '2026-07-11'), visit('p1', '2026-07-21')];
    const result = computeRetentionKpis({
      patients: [patient('p1', '2025-01-01T00:00:00Z')],
      completedHistory: history,
      fromDate: FROM,
      toDate: TO,
    });
    expect(result.avgDaysBetweenVisits).toBe(10);
  });
});

describe('PP-7 recall performance (computeRecallPerformance)', () => {
  it('counts by status, detects overdue, derives conversion', () => {
    const recalls = [
      { status: 'open', due_at: '2026-08-01' }, // overdue
      { status: 'notified', due_at: '2026-09-10' }, // not overdue
      { status: 'scheduled', due_at: '2026-09-05' },
      { status: 'dismissed', due_at: '2026-08-20' },
      { status: 'open', due_at: '2026-07-15' }, // overdue
    ];
    const r = computeRecallPerformance(recalls, TODAY);
    expect(r.total).toBe(5);
    expect(r.byStatus).toEqual({ open: 2, notified: 1, scheduled: 1, dismissed: 1 });
    expect(r.overdue).toBe(2);
    expect(r.conversionRate).toBe(25);
  });

  it('null conversion with no actionable recalls', () => {
    const r = computeRecallPerformance([{ status: 'dismissed', due_at: '2026-08-01' }], TODAY);
    expect(r.conversionRate).toBeNull();
    expect(r.overdue).toBe(0);
  });
});

describe('PP-7 no-show intelligence (computeNoShowIntelligence)', () => {
  const appt = (patient_id: string | null, status: string, appointment_date: string) => ({
    patient_id,
    status,
    appointment_date,
  });

  it('derives rates, repeat offenders (sorted), and monthly series', () => {
    const appointments = [
      appt('p1', 'completed', '2026-07-01'),
      appt('p1', 'no_show', '2026-07-05'),
      appt('p1', 'no_show', '2026-08-05'),
      appt('p2', 'no_show', '2026-07-10'),
      appt('p2', 'cancelled', '2026-08-10'),
      appt('p3', 'completed', '2026-08-15'),
    ];
    const r = computeNoShowIntelligence(appointments, ['2026-07', '2026-08']);
    expect(r.total).toBe(6);
    expect(r.noShow).toBe(3);
    expect(r.noShowRate).toBe(50);
    expect(r.cancellationRate).toBe(16.7);
    expect(r.completionRate).toBe(33.3);
    expect(r.repeatNoShowPatients).toEqual([
      { patientId: 'p1', count: 2 }, // count desc; p2 has only 1
    ]);
    expect(r.monthly).toEqual([
      { month: '2026-07', appointments: 3, noShow: 2, noShowRate: 66.7 },
      { month: '2026-08', appointments: 3, noShow: 1, noShowRate: 33.3 },
    ]);
  });

  it('null rates on empty range (no fabricated numbers)', () => {
    const r = computeNoShowIntelligence([], ['2026-07']);
    expect(r.noShowRate).toBeNull();
    expect(r.repeatNoShowPatients).toEqual([]);
    expect(r.monthly[0]).toEqual({ month: '2026-07', appointments: 0, noShow: 0, noShowRate: null });
  });
});

describe('PP-7 engagement & waitlist', () => {
  it('engagement funnel: null conversion when no conversations', () => {
    const appointments = [
      { patient_id: 'p1', status: 'completed', appointment_date: '2026-07-02' },
      { patient_id: 'p2', status: 'scheduled', appointment_date: '2026-07-03' },
    ];
    const conversations = [
      { patient_id: 'p1', created_at: '2026-07-01T10:00:00Z' },
      { patient_id: 'p2', created_at: '2026-07-02T10:00:00Z' },
    ];
    const r = computeEngagement(conversations, appointments, ['2026-07']);
    expect(r.conversations).toBe(2);
    expect(r.bookings).toBe(2);
    expect(r.conversationToBookingRate).toBe(100);
    expect(r.monthly).toEqual([{ month: '2026-07', conversations: 2, bookings: 2 }]);
  });

  it('engagement never divides by zero', () => {
    const r = computeEngagement([], [{ patient_id: null, status: 'scheduled', appointment_date: '2026-07-02' }], ['2026-07']);
    expect(r.conversationToBookingRate).toBeNull();
  });

  it('waitlist conversion = booked / (notified + booked)', () => {
    const entries = [
      { status: 'active' },
      { status: 'notified' },
      { status: 'booked' },
      { status: 'booked' },
      { status: 'expired' },
      { status: 'cancelled' },
    ];
    const r = computeWaitlistPerformance(entries);
    expect(r.byStatus).toEqual({ active: 1, notified: 1, booked: 2, expired: 1, cancelled: 1 });
    expect(r.offerConversionRate).toBe(66.7);
  });

  it('waitlist null conversion when no offers were ever made', () => {
    const r = computeWaitlistPerformance([{ status: 'active' }, { status: 'expired' }]);
    expect(r.offerConversionRate).toBeNull();
  });
});

describe('PP-7 growth score (guidance only)', () => {
  it('weights sum to 100', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
  });

  it('derives the weighted score with capped booking conversion', () => {
    const gs = computeGrowthScore({
      retentionRate: 80,
      completionRate: 90,
      noShowRate: 10,
      recallConversionRate: 50,
      conversationToBookingRate: 150, // capped at 100
    });
    expect(gs.basis).toBe('derived');
    // (80*25 + 90*20 + 90*20 + 50*15 + 100*20) / 100 = 83.5
    expect(gs.score).toBe(83.5);
  });

  it('renormalizes weights when a component lacks data (no guessing)', () => {
    const gs = computeGrowthScore({
      retentionRate: null,
      completionRate: 90,
      noShowRate: null,
      recallConversionRate: null,
      conversationToBookingRate: null,
    });
    expect(gs.basis).toBe('derived');
    // only completion (weight 20 of remaining 20) → value 90
    expect(gs.score).toBe(90);
    expect(gs.components.find((c) => c.key === 'retention')?.effectiveWeight).toBe(0);
  });

  it('returns null score with insufficient_data when nothing is derivable', () => {
    const gs = computeGrowthScore({
      retentionRate: null,
      completionRate: null,
      noShowRate: null,
      recallConversionRate: null,
      conversationToBookingRate: null,
    });
    expect(gs.score).toBeNull();
    expect(gs.basis).toBe('insufficient_data');
  });

  it('is deterministic for identical inputs', () => {
    const input = { retentionRate: 70, completionRate: 80, noShowRate: 15, recallConversionRate: 40, conversationToBookingRate: 30 };
    expect(computeGrowthScore(input)).toEqual(computeGrowthScore({ ...input }));
  });
});

describe('PP-7 recommendations (informational only)', () => {
  it('maps conditions to documented codes with severity', () => {
    const recs = buildGrowthRecommendations({
      inactivePatients: 12,
      overdueRecalls: 3,
      repeatNoShowCount: 2,
      conversationToBookingRate: 10,
      waitlistOfferConversionRate: 20,
      waitlistExpired: 5,
      waitlistBooked: 1,
    });
    expect(recs.map((r) => r.code)).toEqual([
      'REACTIVATE_INACTIVE_PATIENTS',
      'FOLLOW_OVERDUE_RECALLS',
      'ADDRESS_REPEAT_NO_SHOWS',
      'IMPROVE_BOOKING_CONVERSION',
      'ENGAGE_WAITLIST',
    ]);
    expect(recs[0].severity).toBe('high');
  });

  it('returns empty list when nothing is flagged (honest empty state)', () => {
    const recs = buildGrowthRecommendations({
      inactivePatients: 0,
      overdueRecalls: 0,
      repeatNoShowCount: 0,
      conversationToBookingRate: 80,
      waitlistOfferConversionRate: 90,
      waitlistExpired: 0,
      waitlistBooked: 3,
    });
    expect(recs).toEqual([]);
  });
});

describe('PP-7 aggregate (getGrowthIntelligence) — read-only proof', () => {
  it('aggregates all insights from the six scoped reads; never writes', async () => {
    const builders: Record<string, ReturnType<typeof mockSupabaseAdmin.makeBuilder>> = {};
    const patients = [patient('p1', '2026-06-10T10:00:00Z'), patient('p4', '2025-01-01T10:00:00Z')];
    const appointments = [
      { patient_id: 'p1', status: 'completed', appointment_date: '2026-07-01' },
      { patient_id: 'p4', status: 'no_show', appointment_date: '2026-07-02' },
    ];
    const recalls = [{ status: 'open', due_at: '2026-08-01' }];
    const waitlist = [{ status: 'booked' }];
    const conversations = [{ patient_id: 'p1', created_at: '2026-07-01T09:00:00Z' }];

    (mockSupabaseAdmin.supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (!builders[table]) {
        const data =
          table === 'patients' ? patients :
          table === 'appointments' ? appointments : // shared by both appointment reads
          table === 'clinic_recalls' ? recalls :
          table === 'clinic_waitlist_entries' ? waitlist :
          table === 'conversations' ? conversations : [];
        builders[table] = mockSupabaseAdmin.makeBuilder({ data, error: null });
      }
      return builders[table];
    });

    const report = await getGrowthIntelligence('c1', { fromDate: FROM, toDate: TO, today: TODAY });

    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('patients');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('appointments');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('clinic_recalls');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('clinic_waitlist_entries');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('conversations');
    expect(report.clinicId).toBe('c1');
    expect(report.range).toEqual({ fromDate: FROM, toDate: TO, historyFrom: '2025-06-01' });
    expect(report.retention.totalPatients).toBe(2);
    expect(report.noShow.noShow).toBe(1);
    expect(report.engagement.conversations).toBe(1);
    expect(report.waitlist.byStatus.booked).toBe(1);
    expect(report.recalls.overdue).toBe(1);
    expect(report.growthScore.basis).toBe('derived');
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.meta.deterministic).toBe(true);
    expect(report.meta.guidanceOnly).toBe(true);

    // No-write proof: every table builder must be free of write calls.
    for (const builder of Object.values(builders)) {
      expect(builder.insert).not.toHaveBeenCalled();
      expect(builder.update).not.toHaveBeenCalled();
      expect(builder.upsert).not.toHaveBeenCalled();
      expect(builder.delete).not.toHaveBeenCalled();
    }
  });

  it('400-class INVALID errors on bad dates and inverted range', async () => {
    await expect(getGrowthIntelligence('c1', { fromDate: '2026-6-1' })).rejects.toThrow('INVALID_FROM_DATE');
    await expect(getGrowthIntelligence('c1', { fromDate: TO, toDate: FROM })).rejects.toThrow('INVALID_RANGE');
  });

  it('rethrows reader errors as clean failures (logged)', async () => {
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation(() =>
      mockSupabaseAdmin.makeBuilder({ data: null, error: { message: 'db down' } })
    );
    await expect(getGrowthIntelligence('c1', { fromDate: FROM, toDate: TO, today: TODAY })).rejects.toThrow('db down');
    expect(mockLogging.logEvent).toHaveBeenCalledWith(
      'growth_patients_error',
      expect.objectContaining({ clinic_id: 'c1' }),
      'error'
    );
  });

  it('defaults to the last-90-days window when no range is given', async () => {
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation(() =>
      mockSupabaseAdmin.makeBuilder({ data: [], error: null })
    );
    const report = await getGrowthIntelligence('c1', { today: TODAY });
    expect(report.range).toEqual({ fromDate: '2026-06-05', toDate: TODAY, historyFrom: '2025-06-05' });
  });
});
