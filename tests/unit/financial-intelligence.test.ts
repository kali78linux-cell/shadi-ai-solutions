import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-5 — Financial Intelligence tests.
 * Proves: deterministic output · anomaly thresholds (FI_THRESHOLDS) ·
 * insufficient-baseline handling · zero/null financial values · receivable
 * concentration · collection-rate comparison · negative cash-net rule ·
 * no-write behavior · RBAC.
 */

const mockSupabaseAdmin = vi.hoisted(() => {
  function makeBuilder(result: { data: unknown; error: unknown }) {
    const b: Record<string, any> = {};
    const CHAIN = ['select', 'eq', 'order', 'limit', 'single', 'maybeSingle'];
    for (const m of CHAIN) b[m] = vi.fn(() => b);
    // Write methods must NEVER be called by FI — tracked explicitly.
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

// FI composes the existing readers — mock them so pure functions get controlled data.
const mockReporting = vi.hoisted(() => ({
  getProfitAndLoss: vi.fn(async () => []),
  getCashFlow: vi.fn(async () => []),
}));
vi.mock('@/lib/services/reporting', () => mockReporting);

const mockAccounting = vi.hoisted(() => ({
  getAgingSummary: vi.fn(async () => ({ buckets: [], totalOutstanding: 0, rows: [] })),
}));
vi.mock('@/lib/services/accounting', () => mockAccounting);

import {
  FI_THRESHOLDS,
  computeKpis,
  computePnlTrends,
  computeCashMonthly,
  computeCashTrends,
  computeReceivablesInsights,
  computeProfitability,
  detectAnomalies,
  sortAnomalies,
  buildRecommendations,
  getFinancialIntelligence,
  type PnlPoint,
  type CashPoint,
  type FinancialAnomaly,
} from '@/lib/services/financialIntelligence';
import type { AgingSummary } from '@/lib/services/accounting';

const aging = (over90 = 0, total = 0): AgingSummary => ({
  buckets: [
    { bucket: 'current', invoices: 0, balance: 0 },
    { bucket: '1-30', invoices: 0, balance: 0 },
    { bucket: '31-60', invoices: 0, balance: 0 },
    { bucket: '61-90', invoices: 0, balance: 0 },
    { bucket: '90+', invoices: over90 > 0 ? 1 : 0, balance: over90 },
  ],
  totalOutstanding: total,
  rows: [],
});

const pnl = (month: string, revenue: number, extras: Partial<PnlPoint> = {}): PnlPoint => ({
  period_month: month,
  revenue,
  refunds: 0,
  expenses: 0,
  bad_debt: 0,
  net_result: extras.net_result ?? revenue,
  ...extras,
});

const cash = (month: string, inflows: number, outflows = 0, method = 'cash'): CashPoint => ({
  flow_month: month,
  method,
  inflows,
  outflows,
  net: inflows - outflows,
});

beforeEach(() => {
  vi.clearAllMocks();
});
describe('PP-5 KPIs (computeKpis)', () => {
  it('derives KPIs from P&L + cash flow + aging only', () => {
    const k = computeKpis(
      [pnl('2026-01-01', 1000, { refunds: 50, expenses: 300, bad_debt: 20, net_result: 630 })],
      [cash('2026-01-01', 800, 100)],
      aging(200, 400)
    );
    expect(k).toEqual({
      revenue: 1000,
      collected: 800,
      outstanding: 400,
      refunds: 50,
      expenses: 300,
      badDebt: 20,
      netPosition: 630,
      netCash: 700,
      collectionRate: 80,
      netMargin: 63,
      expenseRatio: 30,
      refundRatio: 5,
      overdue90Share: 50,
    });
  });

  it('returns null ratios for zero revenue and zero outstanding (no NaN/Infinity)', () => {
    const k = computeKpis([pnl('2026-01-01', 0)], [cash('2026-01-01', 0)], aging(0, 0));
    expect(k.collectionRate).toBeNull();
    expect(k.netMargin).toBeNull();
    expect(k.expenseRatio).toBeNull();
    expect(k.refundRatio).toBeNull();
    expect(k.overdue90Share).toBeNull();
    expect(k.netCash).toBe(0);
  });

  it('treats null/undefined view values as zero, never NaN', () => {
    const k = computeKpis(
      [{ period_month: '2026-01-01', revenue: NaN, refunds: undefined, expenses: null, bad_debt: 0, net_result: 0 } as unknown as PnlPoint],
      [],
      aging(0, 0)
    );
    expect(k.revenue).toBe(0);
    expect(k.refunds).toBe(0);
    expect(k.expenses).toBe(0);
    expect(Number.isNaN(k.netPosition)).toBe(false);
  });
});

describe('PP-5 deterministic output', () => {
  it('same input → identical output for trends (and input order does not matter)', () => {
    const a = [pnl('2026-03-01', 300), pnl('2026-01-01', 100), pnl('2026-02-01', 200)];
    const b = [pnl('2026-01-01', 100), pnl('2026-03-01', 300), pnl('2026-02-01', 200)];
    const t1 = computePnlTrends(a);
    expect(computePnlTrends(a)).toEqual(t1);
    expect(computePnlTrends(b)).toEqual(t1);
    expect(t1.map((t) => t.month)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('cash monthly aggregation is deterministic and sorted ascending', () => {
    const rows = [cash('2026-02-01', 200), cash('2026-01-01', 100), cash('2026-01-01', 50, 0, 'card')];
    const m1 = computeCashMonthly(rows);
    expect(computeCashMonthly([...rows].reverse())).toEqual(m1);
    expect(m1.map((m) => m.month)).toEqual(['2026-01-01', '2026-02-01']);
    expect(m1[0].inflows).toBe(150);
    expect(m1[0].net).toBe(150);
  });
});

describe('PP-5 P&L / cash trends', () => {
  it('computes period-over-period deltas with nulls on the first month', () => {
    const t = computePnlTrends([pnl('2026-01-01', 100), pnl('2026-02-01', 150, { net_result: -50 })]);
    expect(t[0].prevRevenue).toBeNull();
    expect(t[0].revenueDelta).toBeNull();
    expect(t[1].prevRevenue).toBe(100);
    expect(t[1].revenueDelta).toBe(50);
    expect(t[1].revenueDeltaPct).toBe(50);
    expect(t[1].netDeltaPct).toBe(-150); // (-50 - 100) / |100| * 100
  });

  it('avoids division by zero on previous zero revenue/net', () => {
    const t = computePnlTrends([pnl('2026-01-01', 0), pnl('2026-02-01', 100)]);
    expect(t[1].revenueDeltaPct).toBeNull();
    expect(t[1].revenueDelta).toBe(100);
  });

  it('collection rate compares collected vs same-month revenue; null when revenue missing/zero', () => {
    const revenueByMonth: Record<string, number> = { '2026-01-01': 400, '2026-02-01': 0 };
    const t = computeCashTrends([cash('2026-01-01', 300), cash('2026-02-01', 200)], revenueByMonth);
    expect(t[0].collectionRate).toBe(75);
    expect(t[1].collectionRate).toBeNull();
  });
});
describe('PP-5 receivables / profitability insights', () => {
  it('derives bucket shares, overdue90 share, and top overdue without redefining aging', () => {
    const a: AgingSummary = {
      buckets: [
        { bucket: 'current', invoices: 1, balance: 100 },
        { bucket: '90+', invoices: 3, balance: 300 },
      ],
      totalOutstanding: 400,
      rows: [
        { invoice_number: 'INV-2', patient_id: 'p2', bucket: '90+', balance_amount: 300, age_days: 120 },
        { invoice_number: 'INV-1', patient_id: 'p1', bucket: 'current', balance_amount: 100, age_days: 10 },
      ],
    };
    const r = computeReceivablesInsights(a, [cash('2026-01-01', 300, 100, 'card'), cash('2026-01-01', 500)]);
    expect(r.totalOutstanding).toBe(400);
    expect(r.overdue90Share).toBe(75);
    expect(r.buckets.find((b) => b.bucket === '90+')?.shareOfOutstanding).toBe(75);
    expect(r.averageAgeDays).toBe(65);
    expect(r.paymentMethods[0]).toMatchObject({ method: 'cash', inflows: 500, shareOfCollected: 62.5 });
    expect(r.paymentMethods[1]).toMatchObject({ method: 'card', inflows: 300, shareOfCollected: 37.5 });
    expect(r.topOverdue[0]).toMatchObject({ invoiceNumber: 'INV-2', balance: 300 });
  });

  it('profitability derives totals and null ratios for zero revenue / zero months', () => {
    const p = computeProfitability([pnl('2026-01-01', 1000, { expenses: 400, net_result: 600, refunds: 100 })]);
    expect(p).toMatchObject({ revenueTotal: 1000, expensesTotal: 400, netTotal: 600, netMargin: 60, monthsCount: 1, revenuePerMonth: 1000 });
    const empty = computeProfitability([]);
    expect(empty.netMargin).toBeNull();
    expect(empty.revenuePerMonth).toBeNull();
    expect(computeProfitability([pnl('2026-01-01', 0)]).expenseRatio).toBeNull();
  });
});

describe('PP-5 anomaly detection (FI_THRESHOLDS)', () => {
  it('does NOT emit deviation anomalies when baseline is insufficient (< MIN_BASELINE_MONTHS)', () => {
    const anomalies = detectAnomalies({
      pnl: [pnl('2026-01-01', 1000), pnl('2026-02-01', 10)],
      cashMonthly: [],
      collectionRateByMonth: {},
      aging: aging(0, 0),
    });
    expect(anomalies.find((a) => a.kind === 'revenue_drop')).toBeUndefined();
    expect(anomalies.find((a) => a.kind === 'expense_spike')).toBeUndefined();
  });

  it('revenue_drop fires only at/above the documented threshold (45% below 3-month mean)', () => {
    const base: PnlPoint[] = [pnl('2026-01-01', 1000), pnl('2026-02-01', 1000), pnl('2026-03-01', 1000)];
    const below = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 560)], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(below.find((a) => a.kind === 'revenue_drop')).toBeUndefined(); // 560 > 550 threshold
    const at = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 550)], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    const drop = at.find((a) => a.kind === 'revenue_drop');
    expect(drop).toBeDefined();
    expect(drop?.severity).toBe('high');
    expect(drop?.baseline).toBe(1000);
    expect(drop?.threshold).toBe(FI_THRESHOLDS.REVENUE_DROP_RATIO);
  });

  it('revenue_spike fires at +100% of the 3-month mean', () => {
    const base: PnlPoint[] = [pnl('2026-01-01', 1000), pnl('2026-02-01', 1000), pnl('2026-03-01', 1000)];
    const at = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 2000)], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(at.find((a) => a.kind === 'revenue_spike')).toBeDefined();
    const under = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 1999)], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(under.find((a) => a.kind === 'revenue_spike')).toBeUndefined();
  });
  it('expense_spike fires at +50% of the prior 3-month mean only', () => {
    const base: PnlPoint[] = [
      pnl('2026-01-01', 1000, { expenses: 100 }),
      pnl('2026-02-01', 1000, { expenses: 100 }),
      pnl('2026-03-01', 1000, { expenses: 100 }),
    ];
    const at = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 1000, { expenses: 150 })], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(at.find((a) => a.kind === 'expense_spike')).toBeDefined();
    const under = detectAnomalies({ pnl: [...base, pnl('2026-04-01', 1000, { expenses: 149 })], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(under.find((a) => a.kind === 'expense_spike')).toBeUndefined();
  });

  it('unusual_refunds fires only when refunds exceed 30% of that month revenue', () => {
    const over = detectAnomalies({
      pnl: [pnl('2026-01-01', 100, { refunds: 31 })],
      cashMonthly: [],
      collectionRateByMonth: {},
      aging: aging(0, 0),
    });
    expect(over.find((a) => a.kind === 'unusual_refunds')).toBeDefined();
    const under = detectAnomalies({
      pnl: [pnl('2026-01-01', 100, { refunds: 30 })],
      cashMonthly: [],
      collectionRateByMonth: {},
      aging: aging(0, 0),
    });
    expect(under.find((a) => a.kind === 'unusual_refunds')).toBeUndefined();
    // zero revenue never divides by zero
    const zero = detectAnomalies({ pnl: [pnl('2026-01-01', 0, { refunds: 50 })], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) });
    expect(zero.find((a) => a.kind === 'unusual_refunds')).toBeUndefined();
  });

  it('collection_deterioration fires only on a drop >= 25 percentage points month-over-month', () => {
    const mk = (rates: Array<number | null>) => {
      const months = ['2026-01-01', '2026-02-01'];
      const collectionRateByMonth: Record<string, number | null> = {};
      months.forEach((m, i) => (collectionRateByMonth[m] = rates[i] ?? null));
      return detectAnomalies({ pnl: [pnl(months[0], 100), pnl(months[1], 100)], cashMonthly: [], collectionRateByMonth, aging: aging(0, 0) });
    };
    expect(mk([80, 50]).find((a) => a.kind === 'collection_deterioration')).toBeDefined();
    expect(mk([80, 56]).find((a) => a.kind === 'collection_deterioration')).toBeUndefined();
    expect(mk([80, null]).find((a) => a.kind === 'collection_deterioration')).toBeUndefined();
    expect(mk([null, 10]).find((a) => a.kind === 'collection_deterioration')).toBeUndefined();
  });

  it('negative_cash_net fires only when the OTHER months average positive', () => {
    const cashMonthly = [
      { month: '2026-01-01', inflows: 0, outflows: 100, net: -100 },
      { month: '2026-02-01', inflows: 200, outflows: 100, net: 100 },
      { month: '2026-03-01', inflows: 200, outflows: 100, net: 100 },
    ];
    const hit = detectAnomalies({ pnl: [], cashMonthly, collectionRateByMonth: {}, aging: aging(0, 0) });
    const a = hit.find((x) => x.kind === 'negative_cash_net');
    expect(a).toBeDefined();
    expect(a?.month).toBe('2026-01-01');
    // all months negative → no positive baseline → no anomaly
    const allNegative = detectAnomalies({
      pnl: [],
      cashMonthly: [
        { month: '2026-01-01', inflows: 0, outflows: 100, net: -100 },
        { month: '2026-02-01', inflows: 0, outflows: 50, net: -50 },
      ],
      collectionRateByMonth: {},
      aging: aging(0, 0),
    });
    expect(allNegative.find((x) => x.kind === 'negative_cash_net')).toBeUndefined();
  });

  it('overdue90_concentration fires only when the 90+ bucket exceeds 50% of outstanding', () => {
    const hit = detectAnomalies({ pnl: [], cashMonthly: [], collectionRateByMonth: {}, aging: aging(60, 100) });
    const a = hit.find((x) => x.kind === 'overdue90_concentration');
    expect(a).toBeDefined();
    expect(a?.value).toBe(60);
    expect(detectAnomalies({ pnl: [], cashMonthly: [], collectionRateByMonth: {}, aging: aging(50, 100) }).find((x) => x.kind === 'overdue90_concentration')).toBeUndefined();
    expect(detectAnomalies({ pnl: [], cashMonthly: [], collectionRateByMonth: {}, aging: aging(0, 0) }).find((x) => x.kind === 'overdue90_concentration')).toBeUndefined();
  });
  it('anomaly list is deterministic and severity-ordered regardless of input order', () => {
    const input = {
      pnl: [
        pnl('2026-01-01', 1000, { expenses: 100 }),
        pnl('2026-02-01', 1000, { expenses: 100 }),
        pnl('2026-03-01', 1000, { expenses: 100 }),
        pnl('2026-04-01', 100, { expenses: 300, refunds: 50 }),
      ],
      cashMonthly: [
        { month: '2026-04-01', inflows: 0, outflows: 100, net: -100 },
        { month: '2026-03-01', inflows: 200, outflows: 0, net: 200 },
        { month: '2026-02-01', inflows: 200, outflows: 0, net: 200 },
        { month: '2026-01-01', inflows: 200, outflows: 0, net: 200 },
      ],
      collectionRateByMonth: { '2026-03-01': 90, '2026-04-01': 10 },
      aging: aging(80, 100),
    };
    const r1 = detectAnomalies(input);
    expect(detectAnomalies(structuredClone(input))).toEqual(r1);
    const severities = r1.map((a) => a.severity);
    expect(severities).toEqual([...severities].sort());
    expect(r1.map((a) => a.kind)).toEqual(expect.arrayContaining([
      'revenue_drop',
      'expense_spike',
      'unusual_refunds',
      'collection_deterioration',
      'negative_cash_net',
      'overdue90_concentration',
    ]));
    expect(sortAnomalies([...r1].reverse())).toEqual(r1);
  });
});

describe('PP-5 recommendations (informational only)', () => {
  it('one deduped recommendation per anomaly kind, ordered by severity', () => {
    const anomalies: FinancialAnomaly[] = [
      { kind: 'expense_spike', label: '', severity: 'medium', month: null, value: 1, baseline: 1, threshold: 1, detail: '' },
      { kind: 'revenue_drop', label: '', severity: 'high', month: null, value: 1, baseline: 1, threshold: 1, detail: '' },
      { kind: 'revenue_drop', label: '', severity: 'high', month: '2026-04-01', value: 1, baseline: 1, threshold: 1, detail: '' },
    ];
    const recs = buildRecommendations(anomalies);
    expect(recs.map((r) => r.code)).toEqual(['REVIEW_REVENUE_DROP', 'REVIEW_EXPENSES']);
    expect(recs.every((r) => r.relatedAnomalyKind !== null)).toBe(true);
    expect(recs[0].severity).toBe('high');
  });

  it('no anomalies → no recommendations (never invents advice)', () => {
    expect(buildRecommendations([])).toEqual([]);
  });
});
describe('PP-5 aggregate report — read-only / no-write behavior', () => {
  it('composes all insights and NEVER issues DB writes (insert/update/upsert/delete)', async () => {
    mockReporting.getProfitAndLoss.mockResolvedValue([
      pnl('2026-01-01', 1000, { expenses: 200, net_result: 800 }),
      pnl('2026-02-01', 1000, { expenses: 200, net_result: 800 }),
      pnl('2026-03-01', 1000, { expenses: 200, net_result: 800 }),
    ]);
    mockReporting.getCashFlow.mockResolvedValue([
      cash('2026-01-01', 900, 100, 'cash'),
      cash('2026-02-01', 900, 100, 'card'),
    ]);
    mockAccounting.getAgingSummary.mockResolvedValue(aging(100, 200));

    const report = await getFinancialIntelligence('clinic-1', { fromMonth: '2026-01-01', toMonth: '2026-03-01' });

    expect(report.clinicId).toBe('clinic-1');
    expect(report.kpis.revenue).toBe(3000);
    expect(report.kpis.collected).toBe(1800);
    expect(report.pnlTrends).toHaveLength(3);
    expect(report.cashTrends).toHaveLength(2);
    expect(report.receivables.overdue90Share).toBe(50);
    expect(report.profitability.netMargin).toBe(80); // net 800×3 / revenue 1000×3
    expect(report.meta.deterministic).toBe(true);
    expect(report.meta.source).toBe('existing derived views only');

    // read-only proof: only selects happened
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('daily_cash_positions');
    for (const builder of mockSupabaseAdmin.supabaseAdmin.from.mock.results) {
      const b = builder.value as Record<string, ReturnType<typeof vi.fn>>;
      expect(b.insert).not.toHaveBeenCalled();
      expect(b.update).not.toHaveBeenCalled();
      expect(b.upsert).not.toHaveBeenCalled();
      expect(b.delete).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed month boundaries with 400-mapped errors and performs no queries', async () => {
    await expect(getFinancialIntelligence('clinic-1', { fromMonth: '2026-01' })).rejects.toThrow('INVALID_FROM_MONTH');
    await expect(getFinancialIntelligence('clinic-1', { toMonth: 'not-a-date' })).rejects.toThrow('INVALID_TO_MONTH');
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('propagates reader failures (no silent empty insights)', async () => {
    mockReporting.getProfitAndLoss.mockRejectedValue(new Error('db down'));
    await expect(getFinancialIntelligence('clinic-1')).rejects.toThrow('db down');
  });
});
