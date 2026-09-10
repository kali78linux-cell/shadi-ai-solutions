/**
 * PP-5 — Financial Intelligence (deterministic, read-only; owner-approved 2026-09-02).
 *
 * Scope: clinic-facing financial insights — KPIs, trends, anomaly detection,
 * receivables/payments, profitability, cash-flow, actionable recommendations.
 * OUT OF SCOPE (hard): autonomous financial actions · automatic refunds ·
 * ledger/accounting changes · AI conversation layer · patient-facing financial
 * intelligence · forecasting that invents facts.
 *
 * All outputs are DERIVED at read time from the existing source of truth:
 *   financial_period_summary (D-R1 P&L — clinic-local months)
 *   cash_flow_summary       (D-R2 cash flow + collected by method)
 *   receivable_aging        (aging AS-IS — never redefined)
 *   daily_cash_positions    (cash-register, cash method only)
 *   + the existing service readers (reporting.ts / accounting.ts).
 * NO writes. NO new financial source. NO ledger kinds. Period boundaries come
 * pre-computed from the views (D3) — this module never re-derives timezone,
 * business date, or clinic-local month.
 *
 * Anomaly rules are RULE-BASED with the documented thresholds in FI_THRESHOLDS.
 * "Anomaly" is only emitted when the baseline/threshold is provable from data.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getProfitAndLoss, getCashFlow, type PeriodRange } from './reporting';
import { getAgingSummary, type AgingSummary } from './accounting';

export type PnlPoint = {
  period_month: string;
  revenue: number;
  refunds: number;
  expenses: number;
  bad_debt: number;
  net_result: number;
};

export type CashPoint = {
  flow_month: string;
  method: string;
  inflows: number;
  outflows: number;
  net: number;
};

/**
 * Documented anomaly thresholds (all rule-based, no forecasting):
 *  - revenue drop/spike vs the 3+ month mean of the range
 *  - refunds > 30% of that month's revenue
 *  - expense spike >= +50% above the range's prior-month mean
 *  - collection-rate drop >= 25 percentage points month-over-month
 *  - month with negative cash net while the mean of the OTHER months is positive
 *  - receivables concentration: 90+ bucket > 50% of total outstanding
 * Deviation rules require at least MIN_BASELINE_MONTHS prior months.
 */
export const FI_THRESHOLDS = {
  MIN_BASELINE_MONTHS: 3,
  REVENUE_DROP_RATIO: 0.45,
  REVENUE_SPIKE_RATIO: 1.0,
  REFUND_RATIO_LIMIT: 0.3,
  EXPENSE_SPIKE_RATIO: 0.5,
  COLLECTION_DROP_POINTS: 0.25,
  OVERDUE90_SHARE_LIMIT: 0.5,
} as const;

const r2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const num = (v: unknown): number => r2(Number(v ?? 0));
const sum = (vals: number[]): number =>
  r2(vals.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0));
const mean = (vals: number[]): number | null => (vals.length ? sum(vals) / vals.length : null);

function assertMonth(value?: string | null, label = 'month'): void {
  if (!value) return;
  if (!/^\d{4}-\d{2}-01$/.test(value)) throw new Error(`INVALID_${label.toUpperCase()}`);
}

/** Stable ascending sort helper — deterministic output for any input order. */
export function sortMonthAsc<T>(rows: T[], key: (r: T) => string): T[] {
  return [...rows].sort((a, b) => key(a).localeCompare(key(b)));
}

// ---------------------------------------------------------------------------
// 1) Financial KPIs
//    All KPI definitions are provable from the existing views:
//    revenue/refunds/expenses/bad-debt/net = financial_period_summary (D-R1)
//    collected/cashOut = cash_flow_summary inflows/outflows (all methods)
//    outstanding = receivable_aging total (snapshot, aging AS-IS)
//    collectionRate = collected / revenue in the same range. This is "payments
//    received in the range vs revenue billed in the range" and MAY exceed 100%
//    when payments for older invoices arrive in the range (honest, documented).
// ---------------------------------------------------------------------------
export type FinancialKpis = {
  revenue: number;
  collected: number;
  outstanding: number;
  refunds: number;
  expenses: number;
  badDebt: number;
  netPosition: number;
  netCash: number;
  /** collected / revenue (%), nullable when revenue <= 0. */
  collectionRate: number | null;
  /** netPosition / revenue (%), nullable when revenue <= 0. */
  netMargin: number | null;
  /** expenses / revenue (%), nullable when revenue <= 0. */
  expenseRatio: number | null;
  /** refunds / revenue (%), nullable when revenue <= 0. */
  refundRatio: number | null;
  /** 90+ bucket / total outstanding (%), nullable when outstanding <= 0. */
  overdue90Share: number | null;
};

export function computeKpis(pnl: PnlPoint[], cash: CashPoint[], aging: AgingSummary): FinancialKpis {
  const revenue = sum(pnl.map((p) => num(p.revenue)));
  const refunds = sum(pnl.map((p) => num(p.refunds)));
  const expenses = sum(pnl.map((p) => num(p.expenses)));
  const badDebt = sum(pnl.map((p) => num(p.bad_debt)));
  const netPosition = sum(pnl.map((p) => num(p.net_result)));
  const collected = sum(cash.map((c) => num(c.inflows)));
  const cashOut = sum(cash.map((c) => num(c.outflows)));
  const netCash = r2(collected - cashOut);
  const outstanding = r2(aging.totalOutstanding);
  const overdue90 = aging.buckets.find((b) => b.bucket === '90+')?.balance ?? 0;
  return {
    revenue,
    collected,
    outstanding,
    refunds,
    expenses,
    badDebt,
    netPosition,
    netCash,
    collectionRate: revenue > 0 ? r2((collected / revenue) * 100) : null,
    netMargin: revenue > 0 ? r2((netPosition / revenue) * 100) : null,
    expenseRatio: revenue > 0 ? r2((expenses / revenue) * 100) : null,
    refundRatio: revenue > 0 ? r2((refunds / revenue) * 100) : null,
    overdue90Share: outstanding > 0 ? r2((overdue90 / outstanding) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// 2) P&L Trends — monthly series with period-over-period deltas (derived only).
// ---------------------------------------------------------------------------
export type PnlTrendPoint = {
  month: string;
  revenue: number;
  refunds: number;
  expenses: number;
  badDebt: number;
  net: number;
  prevRevenue: number | null;
  revenueDelta: number | null;
  revenueDeltaPct: number | null;
  prevNet: number | null;
  netDelta: number | null;
  netDeltaPct: number | null;
};

export function computePnlTrends(pnl: PnlPoint[]): PnlTrendPoint[] {
  const rows = sortMonthAsc(pnl, (p) => p.period_month).map((p) => ({
    month: p.period_month,
    revenue: num(p.revenue),
    refunds: num(p.refunds),
    expenses: num(p.expenses),
    badDebt: num(p.bad_debt),
    net: num(p.net_result),
  }));
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const revenueDelta = prev ? r2(r.revenue - prev.revenue) : null;
    const netDelta = prev ? r2(r.net - prev.net) : null;
    return {
      ...r,
      prevRevenue: prev ? prev.revenue : null,
      revenueDelta,
      revenueDeltaPct:
        prev && prev.revenue !== 0 ? r2(((r.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100) : null,
      prevNet: prev ? prev.net : null,
      netDelta,
      netDeltaPct: prev && prev.net !== 0 ? r2(((r.net - prev.net) / Math.abs(prev.net)) * 100) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 3) Cash-flow trends — per-month aggregation + collection rate per month.
//    collectionRate per month = inflows(month) / revenue(month) (nullable).
// ---------------------------------------------------------------------------
export type CashMonthlyPoint = {
  month: string;
  inflows: number;
  outflows: number;
  net: number;
};

export function computeCashMonthly(cash: CashPoint[]): CashMonthlyPoint[] {
  const byMonth = new Map<string, { inflows: number; outflows: number; net: number }>();
  for (const c of cash) {
    const cur = byMonth.get(c.flow_month) ?? { inflows: 0, outflows: 0, net: 0 };
    cur.inflows = sum([cur.inflows, num(c.inflows)]);
    cur.outflows = sum([cur.outflows, num(c.outflows)]);
    cur.net = r2(cur.inflows - cur.outflows);
    byMonth.set(c.flow_month, cur);
  }
  return Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export type CashTrendPoint = CashMonthlyPoint & {
  prevNet: number | null;
  netDelta: number | null;
  netDeltaPct: number | null;
  /** inflows(month) / revenue(month) in %, nullable when revenue <= 0. */
  collectionRate: number | null;
};

export function computeCashTrends(cash: CashPoint[], revenueByMonth: Record<string, number> = {}): CashTrendPoint[] {
  const months = computeCashMonthly(cash);
  return months.map((r, i) => {
    const prev = i > 0 ? months[i - 1] : null;
    const rev = revenueByMonth[r.month];
    const collectionRate = rev && rev > 0 ? r2((r.inflows / rev) * 100) : null;
    const netDelta = prev ? r2(r.net - prev.net) : null;
    return {
      ...r,
      prevNet: prev ? prev.net : null,
      netDelta,
      netDeltaPct: prev && prev.net !== 0 ? r2(((r.net - prev.net) / Math.abs(prev.net)) * 100) : null,
      collectionRate,
    };
  });
}

// ---------------------------------------------------------------------------
// 4) Receivables / payment insights — over receivable_aging (AS-IS, never
//    redefined) + cash_flow_summary method split. All derived, never stored.
// ---------------------------------------------------------------------------
export type AgingBucketInsight = {
  bucket: string;
  invoices: number;
  balance: number;
  shareOfOutstanding: number | null;
};

export type PaymentMethodInsight = {
  method: string;
  inflows: number;
  outflows: number;
  shareOfCollected: number | null;
  shareOfOutflows: number | null;
};

export type TopOverdueInvoice = {
  invoiceNumber: string;
  patientId: string;
  bucket: string;
  balance: number;
};

export type ReceivablesInsights = {
  totalOutstanding: number;
  buckets: AgingBucketInsight[];
  overdue90Share: number | null;
  averageAgeDays: number | null;
  paymentMethods: PaymentMethodInsight[];
  topOverdue: TopOverdueInvoice[];
};

export function computeReceivablesInsights(aging: AgingSummary, cash: CashPoint[]): ReceivablesInsights {
  const total = r2(aging.totalOutstanding);
  const overdue90 = aging.buckets.find((b) => b.bucket === '90+')?.balance ?? 0;
  const buckets: AgingBucketInsight[] = aging.buckets.map((b) => ({
    bucket: b.bucket,
    invoices: b.invoices,
    balance: r2(b.balance),
    shareOfOutstanding: total > 0 ? r2((b.balance / total) * 100) : null,
  }));
  const ages = aging.rows.map((r) => Number(r.age_days ?? 0)).filter((n) => Number.isFinite(n));
  const averageAgeDays = ages.length ? r2(ages.reduce((s, n) => s + n, 0) / ages.length) : null;

  const byMethod = new Map<string, { inflows: number; outflows: number }>();
  for (const c of cash) {
    const cur = byMethod.get(c.method) ?? { inflows: 0, outflows: 0 };
    cur.inflows = sum([cur.inflows, num(c.inflows)]);
    cur.outflows = sum([cur.outflows, num(c.outflows)]);
    byMethod.set(c.method, cur);
  }
  const totalIn = sum(Array.from(byMethod.values()).map((v) => v.inflows));
  const totalOut = sum(Array.from(byMethod.values()).map((v) => v.outflows));
  const paymentMethods: PaymentMethodInsight[] = Array.from(byMethod.entries())
    .map(([method, v]) => ({
      method,
      inflows: v.inflows,
      outflows: v.outflows,
      shareOfCollected: totalIn > 0 ? r2((v.inflows / totalIn) * 100) : null,
      shareOfOutflows: totalOut > 0 ? r2((v.outflows / totalOut) * 100) : null,
    }))
    .sort((a, b) => b.inflows - a.inflows);

  const topOverdue: TopOverdueInvoice[] = aging.rows
    .map((r) => ({
      invoiceNumber: String(r.invoice_number ?? ''),
      patientId: String(r.patient_id ?? ''),
      bucket: String(r.bucket ?? ''),
      balance: num(r.balance_amount),
    }))
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5);

  return {
    totalOutstanding: total,
    buckets,
    overdue90Share: total > 0 ? r2((overdue90 / total) * 100) : null,
    averageAgeDays,
    paymentMethods,
    topOverdue,
  };
}

// ---------------------------------------------------------------------------
// 5) Profitability insights — derived from P&L only (D-R1 untouched).
// ---------------------------------------------------------------------------
export type ProfitabilityInsights = {
  revenueTotal: number;
  expensesTotal: number;
  netTotal: number;
  netMargin: number | null;
  expenseRatio: number | null;
  refundRatio: number | null;
  monthsCount: number;
  revenuePerMonth: number | null;
  expensesPerMonth: number | null;
};

export function computeProfitability(pnl: PnlPoint[]): ProfitabilityInsights {
  const revenueTotal = sum(pnl.map((p) => num(p.revenue)));
  const expensesTotal = sum(pnl.map((p) => num(p.expenses)));
  const netTotal = sum(pnl.map((p) => num(p.net_result)));
  const refundsTotal = sum(pnl.map((p) => num(p.refunds)));
  const monthsCount = pnl.length;
  return {
    revenueTotal,
    expensesTotal,
    netTotal,
    netMargin: revenueTotal > 0 ? r2((netTotal / revenueTotal) * 100) : null,
    expenseRatio: revenueTotal > 0 ? r2((expensesTotal / revenueTotal) * 100) : null,
    refundRatio: revenueTotal > 0 ? r2((refundsTotal / revenueTotal) * 100) : null,
    monthsCount,
    revenuePerMonth: monthsCount > 0 ? r2(revenueTotal / monthsCount) : null,
    expensesPerMonth: monthsCount > 0 ? r2(expensesTotal / monthsCount) : null,
  };
}

// ---------------------------------------------------------------------------
// 6) Anomaly detection — RULE-BASED with the documented FI_THRESHOLDS.
//    "Anomaly" is only emitted when a baseline/threshold is provable from the
//    data present in the requested range. No forecasting, no extrapolation.
// ---------------------------------------------------------------------------
export type FinancialAnomalyKind =
  | 'revenue_drop'
  | 'revenue_spike'
  | 'unusual_refunds'
  | 'expense_spike'
  | 'collection_deterioration'
  | 'negative_cash_net'
  | 'overdue90_concentration';

export type FinancialAnomaly = {
  kind: FinancialAnomalyKind;
  label: string;
  severity: 'high' | 'medium' | 'low';
  month: string | null;
  value: number | null;
  baseline: number | null;
  threshold: number | null;
  detail: string;
};

const ANOMALY_META: Record<FinancialAnomalyKind, { label: string; severity: 'high' | 'medium' | 'low' }> = {
  revenue_drop: { label: 'انخفاض غير معتاد في الإيرادات', severity: 'high' },
  revenue_spike: { label: 'ارتفاع غير معتاد في الإيرادات', severity: 'low' },
  unusual_refunds: { label: 'استردادات غير معتادة', severity: 'medium' },
  expense_spike: { label: 'ارتفاع غير معتاد في المصروفات', severity: 'medium' },
  collection_deterioration: { label: 'تدهور نسبة التحصيل', severity: 'medium' },
  negative_cash_net: { label: 'تدفق نقدي شهري سالب', severity: 'medium' },
  overdue90_concentration: { label: 'تركّز عالٍ للفواتير المتأخرة (90+)', severity: 'high' },
};

const SEVERITY_ORDER: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };

export function sortAnomalies(anomalies: FinancialAnomaly[]): FinancialAnomaly[] {
  return [...anomalies].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (a.month ?? '').localeCompare(b.month ?? '') ||
      a.kind.localeCompare(b.kind)
  );
}

function makeAnomaly(
  kind: FinancialAnomalyKind,
  month: string | null,
  value: number,
  baseline: number | null,
  threshold: number,
  detail: string
): FinancialAnomaly {
  const meta = ANOMALY_META[kind];
  return {
    kind,
    label: meta.label,
    severity: meta.severity,
    month,
    value: r2(value),
    baseline: baseline != null ? r2(baseline) : null,
    threshold: r2(threshold),
    detail,
  };
}

export type DetectAnomaliesInput = {
  pnl: PnlPoint[];
  cashMonthly: CashMonthlyPoint[];
  collectionRateByMonth: Record<string, number | null>;
  aging: AgingSummary;
};

export function detectAnomalies(input: DetectAnomaliesInput): FinancialAnomaly[] {
  const { pnl, cashMonthly, collectionRateByMonth, aging } = input;
  const anomalies: FinancialAnomaly[] = [];
  const rows = sortMonthAsc(pnl, (p) => p.period_month);
  const priorRevenue: number[] = [];
  const priorExpenses: number[] = [];
  const nets = cashMonthly.map((c) => num(c.net));

  rows.forEach((p, i) => {
    const month = p.period_month;
    const revenue = num(p.revenue);
    const expenses = num(p.expenses);
    const refunds = num(p.refunds);

    const revBaseline =
      priorRevenue.length >= FI_THRESHOLDS.MIN_BASELINE_MONTHS
        ? mean(priorRevenue.slice(-FI_THRESHOLDS.MIN_BASELINE_MONTHS))
        : null;
    if (revBaseline !== null && revBaseline > 0) {
      if (revenue <= revBaseline * (1 - FI_THRESHOLDS.REVENUE_DROP_RATIO)) {
        anomalies.push(
          makeAnomaly(
            'revenue_drop',
            month,
            revenue,
            revBaseline,
            FI_THRESHOLDS.REVENUE_DROP_RATIO,
            `إيراد ${month} أقل بنسبة ${r2((1 - revenue / revBaseline) * 100)}% من متوسط الأشهر السابقة`
          )
        );
      } else if (revenue >= revBaseline * (1 + FI_THRESHOLDS.REVENUE_SPIKE_RATIO)) {
        anomalies.push(
          makeAnomaly(
            'revenue_spike',
            month,
            revenue,
            revBaseline,
            FI_THRESHOLDS.REVENUE_SPIKE_RATIO,
            `إيراد ${month} أعلى بنسبة ${r2((revenue / revBaseline - 1) * 100)}% من متوسط الأشهر السابقة`
          )
        );
      }
    }

    const expBaseline =
      priorExpenses.length >= FI_THRESHOLDS.MIN_BASELINE_MONTHS
        ? mean(priorExpenses.slice(-FI_THRESHOLDS.MIN_BASELINE_MONTHS))
        : null;
    if (expBaseline !== null && expBaseline > 0 && expenses >= expBaseline * (1 + FI_THRESHOLDS.EXPENSE_SPIKE_RATIO)) {
      anomalies.push(
        makeAnomaly(
          'expense_spike',
          month,
          expenses,
          expBaseline,
          FI_THRESHOLDS.EXPENSE_SPIKE_RATIO,
          `مصروفات ${month} أعلى من متوسط الأشهر السابقة`
        )
      );
    }

    if (revenue > 0 && refunds / revenue > FI_THRESHOLDS.REFUND_RATIO_LIMIT) {
      anomalies.push(
        makeAnomaly(
          'unusual_refunds',
          month,
          refunds,
          revenue,
          FI_THRESHOLDS.REFUND_RATIO_LIMIT,
          `الاستردادات ${r2((refunds / revenue) * 100)}% من إيراد الشهر`
        )
      );
    }

    const curRate = collectionRateByMonth[month] ?? null;
    if (i > 0) {
      const prevRate = collectionRateByMonth[rows[i - 1].period_month] ?? null;
      if (prevRate !== null && curRate !== null && prevRate - curRate >= FI_THRESHOLDS.COLLECTION_DROP_POINTS * 100) {
        anomalies.push(
          makeAnomaly(
            'collection_deterioration',
            month,
            curRate,
            prevRate,
            FI_THRESHOLDS.COLLECTION_DROP_POINTS * 100,
            `نسبة التحصيل ${month} (${r2(curRate)}%) أقل من الشهر السابق (${r2(prevRate)}%)`
          )
        );
      }
    }

    priorRevenue.push(revenue);
    priorExpenses.push(expenses);
  });

  nets.forEach((net, idx) => {
    if (net >= 0) return;
    const others = nets.filter((_, j) => j !== idx);
    const baseline = mean(others);
    if (baseline !== null && baseline > 0) {
      const month = cashMonthly[idx]?.month ?? null;
      anomalies.push(
        makeAnomaly('negative_cash_net', month, net, baseline, 0, `صافي التدفق النقدي لشهر ${month ?? ''} سالب`)
      );
    }
  });

  const totalOut = r2(aging.totalOutstanding);
  const overdue90 = aging.buckets.find((b) => b.bucket === '90+')?.balance ?? 0;
  if (totalOut > 0 && overdue90 / totalOut > FI_THRESHOLDS.OVERDUE90_SHARE_LIMIT) {
    anomalies.push(
      makeAnomaly(
        'overdue90_concentration',
        null,
        r2((overdue90 / totalOut) * 100),
        FI_THRESHOLDS.OVERDUE90_SHARE_LIMIT * 100,
        FI_THRESHOLDS.OVERDUE90_SHARE_LIMIT,
        'أكثر من نصف المستحقات في فئة 90+ يومًا'
      )
    );
  }

  return sortAnomalies(anomalies);
}

// ---------------------------------------------------------------------------
// 7) Actionable recommendations — informational ONLY, never executed.
//    One recommendation per anomaly kind (deduped), ordered by severity.
// ---------------------------------------------------------------------------
export type FinancialRecommendation = {
  code:
    | 'REVIEW_OVERDUE'
    | 'REVIEW_REVENUE_DROP'
    | 'FOLLOW_COLLECTION_DROP'
    | 'REVIEW_EXPENSES'
    | 'REVIEW_CASH_FLOW'
    | 'REVIEW_UNUSUAL_REFUNDS'
    | 'NOTE_REVENUE_SPIKE';
  severity: 'high' | 'medium' | 'low';
  message: string;
  relatedAnomalyKind: FinancialAnomalyKind | null;
};

const RECOMMENDATION_META: Record<FinancialAnomalyKind, { code: FinancialRecommendation['code']; message: string }> = {
  overdue90_concentration: {
    code: 'REVIEW_OVERDUE',
    message: 'راجع الفواتير المتأخرة (90+) واتخذ إجراء تحصيل مناسب',
  },
  revenue_drop: {
    code: 'REVIEW_REVENUE_DROP',
    message: 'راجع انخفاض الإيرادات في الفترة المشمولة',
  },
  collection_deterioration: {
    code: 'FOLLOW_COLLECTION_DROP',
    message: 'تابع انخفاض نسبة التحصيل وتحقق من أسباب التأخر',
  },
  expense_spike: {
    code: 'REVIEW_EXPENSES',
    message: 'راجع ارتفاع المصروفات في الفترة المشمولة',
  },
  negative_cash_net: {
    code: 'REVIEW_CASH_FLOW',
    message: 'راجع تغيّر التدفق النقدي (صافي سالب في أحد الأشهر)',
  },
  unusual_refunds: {
    code: 'REVIEW_UNUSUAL_REFUNDS',
    message: 'راجع الاستردادات غير المعتادة في الفترة المشمولة',
  },
  revenue_spike: {
    code: 'NOTE_REVENUE_SPIKE',
    message: 'لاحظ ارتفاع الإيرادات وتحقّق من دوافعه',
  },
};

export function buildRecommendations(anomalies: FinancialAnomaly[]): FinancialRecommendation[] {
  const seen = new Set<FinancialRecommendation['code']>();
  const out: FinancialRecommendation[] = [];
  for (const a of sortAnomalies(anomalies)) {
    const meta = RECOMMENDATION_META[a.kind];
    if (!meta || seen.has(meta.code)) continue;
    seen.add(meta.code);
    out.push({ code: meta.code, severity: a.severity, message: meta.message, relatedAnomalyKind: a.kind });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 8) Aggregate report — composes every derived insight for one clinic.
//    This is the stable PP-5 interface consumed by the API/dashboard.
// ---------------------------------------------------------------------------
export type CashRegisterPoint = {
  businessDate: string;
  cashIn: number;
  cashOut: number;
  netCash: number;
};

export type FinancialIntelligenceReport = {
  clinicId: string;
  range: { fromMonth: string | null; toMonth: string | null };
  kpis: FinancialKpis;
  pnlTrends: PnlTrendPoint[];
  cashTrends: CashTrendPoint[];
  receivables: ReceivablesInsights;
  profitability: ProfitabilityInsights;
  cashRegister: CashRegisterPoint[];
  anomalies: FinancialAnomaly[];
  recommendations: FinancialRecommendation[];
  meta: { generatedAt: string; deterministic: true; source: 'existing derived views only' };
};

/** Cash-register trend (cash method only) from daily_cash_positions (D-R2 semantics). */
export async function getCashRegisterTrend(clinicId: string, days = 14): Promise<CashRegisterPoint[]> {
  const { data, error } = await supabaseAdmin
    .from('daily_cash_positions')
    .select('clinic_id, business_date, cash_in, cash_out, net_cash')
    .eq('clinic_id', clinicId)
    .order('business_date', { ascending: false })
    .limit(days);
  if (error) {
    logEvent('fi_cash_register_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      businessDate: String(r.business_date ?? ''),
      cashIn: num(r.cash_in),
      cashOut: num(r.cash_out),
      netCash: num(r.net_cash),
    }))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    .slice(-days);
}

export async function getFinancialIntelligence(clinicId: string, range: PeriodRange = {}): Promise<FinancialIntelligenceReport> {
  assertMonth(range.fromMonth, 'from_month');
  assertMonth(range.toMonth, 'to_month');

  const [pnl, cash, aging, cashRegister] = await Promise.all([
    getProfitAndLoss(clinicId, range),
    getCashFlow(clinicId, range),
    getAgingSummary(clinicId),
    getCashRegisterTrend(clinicId),
  ]);

  const pnlPoints: PnlPoint[] = (pnl ?? [])
    .map((p) => ({
      period_month: String(p.period_month ?? ''),
      revenue: num(p.revenue),
      refunds: num(p.refunds),
      expenses: num(p.expenses),
      bad_debt: num(p.bad_debt),
      net_result: num(p.net_result),
    }))
    .filter((p) => p.period_month);

  const cashPoints: CashPoint[] = (cash ?? [])
    .map((c) => ({
      flow_month: String(c.flow_month ?? ''),
      method: String(c.method ?? 'other'),
      inflows: num(c.inflows),
      outflows: num(c.outflows),
      net: num(c.net),
    }))
    .filter((c) => c.flow_month);

  const revenueByMonth: Record<string, number> = {};
  for (const p of pnlPoints) revenueByMonth[p.period_month] = (revenueByMonth[p.period_month] ?? 0) + p.revenue;

  const cashMonthly = computeCashMonthly(cashPoints);
  const collectionRateByMonth: Record<string, number | null> = {};
  for (const c of cashMonthly) {
    const rev = revenueByMonth[c.month];
    collectionRateByMonth[c.month] = rev && rev > 0 ? r2((c.inflows / rev) * 100) : null;
  }

  const kpis = computeKpis(pnlPoints, cashPoints, aging);
  const pnlTrends = computePnlTrends(pnlPoints);
  const cashTrends = computeCashTrends(cashPoints, revenueByMonth);
  const receivables = computeReceivablesInsights(aging, cashPoints);
  const profitability = computeProfitability(pnlPoints);
  const anomalies = detectAnomalies({ pnl: pnlPoints, cashMonthly, collectionRateByMonth, aging });
  const recommendations = buildRecommendations(anomalies);

  return {
    clinicId,
    range: { fromMonth: range.fromMonth ?? null, toMonth: range.toMonth ?? null },
    kpis,
    pnlTrends,
    cashTrends,
    receivables,
    profitability,
    cashRegister,
    anomalies,
    recommendations,
    meta: { generatedAt: new Date().toISOString(), deterministic: true, source: 'existing derived views only' },
  };
}