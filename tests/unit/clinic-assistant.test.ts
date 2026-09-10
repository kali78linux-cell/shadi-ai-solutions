import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AI Clinic Operating Assistant — service tests (deterministic routing, RBAC
 * gating, derived answers, read-only proof).
 */

const mockAppointments = vi.hoisted(() => ({ getAppointments: vi.fn(async () => []) }));
vi.mock('@/lib/services/appointments', () => mockAppointments);

const mockAccounting = vi.hoisted(() => ({
  getAgingSummary: vi.fn(async () => ({ buckets: [], totalOutstanding: 0, rows: [] })),
}));
vi.mock('@/lib/services/accounting', () => mockAccounting);

const mockFI = vi.hoisted(() => ({ getFinancialIntelligence: vi.fn() }));
vi.mock('@/lib/services/financialIntelligence', () => mockFI);

const mockOps = vi.hoisted(() => ({
  getOperationsAnalytics: vi.fn(async () => ({
    period: { from: '2026-08-01', to: '2026-08-31' },
    funnel: {},
    providerSchedule: {},
    resourceUsage: {},
    aiUsage: {},
  })),
}));
vi.mock('@/lib/services/operationsAnalytics', () => mockOps);

// Keep the REAL FINANCE_READ_ROLES matrix semantics.
vi.mock('@/lib/services/clinicAuthorization', () => ({
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
}));

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

import {
  classifyAssistantIntent,
  toolAllowed,
  runClinicAssistant,
  FINANCIAL_TOOLS,
} from '@/lib/services/clinicAssistant';

const report = (overrides: Record<string, unknown> = {}) => ({
  clinicId: 'c1',
  range: { fromMonth: null, toMonth: null },
  kpis: {
    revenue: 3000,
    collected: 1800,
    outstanding: 400,
    refunds: 100,
    expenses: 600,
    badDebt: 0,
    netPosition: 2300,
    netCash: 1200,
    collectionRate: 60,
    netMargin: 76.67,
    expenseRatio: 20,
    refundRatio: 3.33,
    overdue90Share: 50,
    ...overrides,
  },
  pnlTrends: [],
  cashTrends: [{ month: '2026-03-01', inflows: 1800, outflows: 600, net: 1200 }],
  receivables: {
    totalOutstanding: 400,
    buckets: [{ bucket: '90+', invoices: 2, balance: 200, shareOfOutstanding: 50 }],
    overdue90Share: 50,
    averageAgeDays: 40,
    paymentMethods: [],
    topOverdue: [{ invoiceNumber: 'INV-9', patientId: 'p1', bucket: '90+', balance: 200 }],
  },
  profitability: { revenueTotal: 3000, expensesTotal: 600, netTotal: 2300, netMargin: 76.67, expenseRatio: 20, refundRatio: 3.33, monthsCount: 3, revenuePerMonth: 1000, expensesPerMonth: 200 },
  cashRegister: [],
  anomalies: [],
  recommendations: [],
  meta: { generatedAt: 'x', deterministic: true as const, source: 'existing derived views only' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFI.getFinancialIntelligence.mockResolvedValue(report());
});
describe('intent classification (deterministic)', () => {
  it('routes Arabic and English keywords to the right tool', () => {
    expect(classifyAssistantIntent('مواعيد اليوم؟').tool).toBe('today_appointments');
    expect(classifyAssistantIntent('show today schedule').tool).toBe('today_appointments');
    expect(classifyAssistantIntent('وش مؤشرات الإيراد؟').tool).toBe('financial_kpis');
    expect(classifyAssistantIntent('كم المستحقات المتأخرة؟').tool).toBe('receivables');
    expect(classifyAssistantIntent('التدفق النقدي هذا الشهر').tool).toBe('cash_flow');
    expect(classifyAssistantIntent('هل في حالات شاذة؟').tool).toBe('anomalies');
    expect(classifyAssistantIntent('أعطني توصيات').tool).toBe('recommendations');
    expect(classifyAssistantIntent('رصيد مريض p1').tool).toBe('patient_balance');
    expect(classifyAssistantIntent('تحليلات التشغيل').tool).toBe('operations');
  });

  it('never guesses: unknown question → help, and classification is repeatable', () => {
    const q = 'ما الطقس اليوم؟';
    expect(classifyAssistantIntent(q).tool).toBe('help');
    expect(classifyAssistantIntent(q)).toEqual(classifyAssistantIntent(q));
  });
});

describe('role gating (FINANCE_READ_ROLES matrix)', () => {
  it('allows finance roles on financial tools, denies doctor/staff', () => {
    for (const tool of FINANCIAL_TOOLS) {
      expect(toolAllowed('owner', tool)).toBe(true);
      expect(toolAllowed('accountant', tool)).toBe(true);
      expect(toolAllowed('doctor', tool)).toBe(false);
      expect(toolAllowed('staff', tool)).toBe(false);
      expect(toolAllowed(undefined, tool)).toBe(false);
    }
    // operational tools open to all clinic roles
    expect(toolAllowed('doctor', 'today_appointments')).toBe(true);
    expect(toolAllowed('staff', 'operations')).toBe(true);
  });

  it('runClinicAssistant throws FORBIDDEN_TOOL for unauthorized financial ask — no data fetched', async () => {
    await expect(runClinicAssistant({ clinicId: 'c1', role: 'doctor', question: 'المؤشرات المالية' })).rejects.toThrow('FORBIDDEN_TOOL');
    expect(mockFI.getFinancialIntelligence).not.toHaveBeenCalled();
  });

  it('allows receptionist (finance-read) on financial tools per the matrix', async () => {
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'receptionist', question: 'المستحقات' });
    expect(res.tool).toBe('receivables');
    expect(mockFI.getFinancialIntelligence).toHaveBeenCalled();
  });
});
describe('derived answers', () => {
  it('kpis answer contains derived numbers from FI report', async () => {
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'المؤشرات المالية' });
    expect(res.answer).toContain('3,000');
    expect(res.answer).toContain('60');
    expect(res.data).toHaveProperty('kpis');
    expect(res.sources.join(' ')).toContain('financialIntelligence');
  });

  it('receivables answer flags 90+ concentration and lists top overdue', async () => {
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'accountant', question: 'المتأخرات' });
    expect(res.answer).toContain('INV-9');
    expect(res.answer).toContain('90+');
  });

  it('anomalies/recommendations: empty state is explicit, never invented', async () => {
    const a = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'حالات شاذة' });
    expect(a.answer).toContain('لا توجد حالات شاذة');
    const r = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'توصيات' });
    expect(r.answer).toContain('لا توجد توصيات');
  });

  it('anomalies surface when present, marked informational-only', async () => {
    const withAnomaly = report();
    (withAnomaly as { anomalies: unknown[] }).anomalies = [
      { kind: 'revenue_drop', label: 'انخفاض غير معتاد في الإيرادات', severity: 'high', month: '2026-03-01', value: 100, baseline: 1000, threshold: 0.45, detail: 'تفاصيل' },
    ];
    mockFI.getFinancialIntelligence.mockResolvedValue(withAnomaly);
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'شواذ' });
    expect(res.answer).toContain('انخفاض غير معتاد');
    expect(res.answer).toContain('لا يُنفَّذ أي إجراء تلقائيًا');
  });
  it('today_appointments filters by business date and sorts by time', async () => {
    mockAppointments.getAppointments.mockResolvedValue([
      { appointment_date: '2026-09-02', appointment_time: '14:00', patient_name: 'سامر', service: 'تنظيف', status: 'confirmed' },
      { appointment_date: '2026-09-02', appointment_time: '09:00', patient_name: 'ليلى', service: 'فحص', status: 'scheduled' },
      { appointment_date: '2026-09-03', appointment_time: '10:00', patient_name: 'أحمد', service: 'حشو', status: 'confirmed' },
    ]);
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'receptionist', question: 'مواعيد اليوم', today: '2026-09-02' });
    expect(res.answer).toContain('2 موعدًا');
    const appts = (res.data as { appointments: Array<{ patient_name: string }> }).appointments;
    expect(appts.map((a) => a.patient_name)).toEqual(['ليلى', 'سامر']);
    expect(mockAppointments.getAppointments).toHaveBeenCalledWith('c1');
  });

  it('patient_balance requires patient_id (400-mapped) and uses scoped aging', async () => {
    await expect(runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'رصيد مريض' })).rejects.toThrow('PATIENT_ID_REQUIRED');
    mockAccounting.getAgingSummary.mockResolvedValue({
      buckets: [],
      totalOutstanding: 250,
      rows: [{ balance_amount: 250 }],
    });
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'رصيد مريض', patientId: 'p42' });
    expect(res.answer).toContain('250');
    expect(mockAccounting.getAgingSummary).toHaveBeenCalledWith('c1', 'p42');
  });

  it('unknown question returns help without touching any service', async () => {
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'staff', question: 'مرحبا' });
    expect(res.tool).toBe('help');
    expect(res.data).toBeNull();
    expect(mockFI.getFinancialIntelligence).not.toHaveBeenCalled();
    expect(mockAppointments.getAppointments).not.toHaveBeenCalled();
  });
});

describe('read-only invariants', () => {
  it('meta declares readOnly/deterministic/no executed actions', async () => {
    const res = await runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'التدفق النقدي' });
    expect(res.meta.readOnly).toBe(true);
    expect(res.meta.deterministic).toBe(true);
    expect(res.meta.executedActions).toEqual([]);
    expect(res.meta.aiInterpretation).toContain('not-used');
  });

  it('propagates service failure without fabricating an answer', async () => {
    mockFI.getFinancialIntelligence.mockRejectedValue(new Error('db down'));
    await expect(runClinicAssistant({ clinicId: 'c1', role: 'owner', question: 'الإيراد' })).rejects.toThrow('db down');
  });
});



