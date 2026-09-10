/**
 * AI Clinic Operating Assistant — deterministic-first (D8 next step, D6-compliant).
 *
 * Scope (owner-approved D8): clinic-facing staff assistant that answers
 * operational and financial questions. STRICT boundary:
 *  - Data access is EXCLUSIVE via the existing authorized services
 *    (reporting / accounting / financialIntelligence / operationsAnalytics /
 *    appointments) — the same paths the authorized clinic APIs use. No direct
 *    financial-table bypass (D6), no new financial source of truth.
 *  - Financial tools are gated by the SAME FINANCE_READ_ROLES matrix.
 *  - READ-ONLY: no writes, no autonomous actions, no refunds, no ledger touch.
 *  - Deterministic: keyword intent routing + deterministic Arabic answers.
 *    No LLM call is required; an optional note field marks where AI
 *    interpretation WOULD plug in (financial data → authorized service → AI
 *    interpretation → informational output), never executing actions.
 */
import { getAppointments } from './appointments';
import { getAgingSummary, type AgingSummary } from './accounting';
import { getFinancialIntelligence, type FinancialIntelligenceReport } from './financialIntelligence';
import { getOperationsAnalytics, type OperationsAnalytics } from './operationsAnalytics';
import { FINANCE_READ_ROLES } from './clinicAuthorization';

export type ClinicAssistantTool =
  | 'today_appointments'
  | 'operations'
  | 'financial_kpis'
  | 'receivables'
  | 'cash_flow'
  | 'anomalies'
  | 'recommendations'
  | 'patient_balance'
  | 'help';

/** Financial tools require the finance-read RBAC matrix (same as the APIs). */
export const FINANCIAL_TOOLS: readonly ClinicAssistantTool[] = [
  'financial_kpis',
  'receivables',
  'cash_flow',
  'anomalies',
  'recommendations',
  'patient_balance',
];

export function toolAllowed(role: string | undefined, tool: ClinicAssistantTool): boolean {
  if (!FINANCIAL_TOOLS.includes(tool)) return true;
  return FINANCE_READ_ROLES.includes(role ?? '');
}

export type AssistantIntent = { tool: ClinicAssistantTool; patientId: string | null };

/**
 * Deterministic keyword intent routing (Arabic + English). First match wins;
 * unknown questions map to `help` — the assistant never guesses an answer.
 */
export function classifyAssistantIntent(question: string): AssistantIntent {
  const q = question.trim().toLowerCase();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  // patient balance needs a patient context keyword
  if (has('رصيد مريض', 'رصيد المريض', 'patient balance', 'balance for patient')) {
    return { tool: 'patient_balance', patientId: null };
  }
  if (has('مواعيد اليوم', 'جدول اليوم', 'موعد اليوم', 'today appointments', "today's appointments", 'today schedule')) {
    return { tool: 'today_appointments', patientId: null };
  }
  if (has('توصيات', 'انصح', 'recommendation')) {
    return { tool: 'recommendations', patientId: null };
  }
  if (has('شواذ', 'شاذة', 'حالة شاذة', 'anomal', 'غير معتاد')) {
    return { tool: 'anomalies', patientId: null };
  }
  if (has('تدفق', 'كاش فلو', 'cash flow')) {
    return { tool: 'cash_flow', patientId: null };
  }
  if (has('متأخرات', 'مستحقات', 'ذمم', 'تأخير', 'aging', 'outstanding', 'overdue')) {
    return { tool: 'receivables', patientId: null };
  }
  if (has('مؤشر', 'إيراد', 'ايراد', 'تحصيل', 'ربح', 'مصروف', 'kpi', 'revenue', 'profit')) {
    return { tool: 'financial_kpis', patientId: null };
  }
  if (has('تحليلات', 'تشغيل', 'استغلال', 'قمع', 'funnel', 'utilization', 'operations')) {
    return { tool: 'operations', patientId: null };
  }
  return { tool: 'help', patientId: null };
}

export type ClinicAssistantAnswer = {
  clinicId: string;
  tool: ClinicAssistantTool;
  role: string;
  answer: string;
  data: Record<string, unknown> | null;
  sources: string[];
  meta: {
    generatedAt: string;
    deterministic: true;
    readOnly: true;
    executedActions: never[];
    aiInterpretation: 'not-used (deterministic output)';
  };
};

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? 'غير متوفر' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const TOMORROW_HINT = 'يمكنك مراجعة لوحة المواعيد لاتخاذ أي إجراء — المساعد استشاري فقط ولا ينفذ إجراءات.';
// ---------------------------------------------------------------------------
// Deterministic answer builders — one per tool, all derived from service output.
// ---------------------------------------------------------------------------

function buildTodayAppointmentsAnswer(
  rows: Array<{ patient_name: string; service: string; appointment_time: string; status: string }>,
  today: string
): { answer: string; data: Record<string, unknown> } {
  const todays = rows
    .filter((a) => (a as { appointment_date?: string }).appointment_date === today)
    .sort((a, b) => String(a.appointment_time).localeCompare(String(b.appointment_time)));
  const byStatus = todays.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const lines = todays
    .slice(0, 10)
    .map((a) => `• ${a.appointment_time} — ${a.patient_name} (${a.service}) [${a.status}]`);
  const answer =
    todays.length === 0
      ? `لا توجد مواعيد مسجلة بتاريخ ${today}.`
      : `لديك ${todays.length} موعدًا بتاريخ ${today}:\n${lines.join('\n')}\nالحالات: ${JSON.stringify(byStatus)}\n${TOMORROW_HINT}`;
  return { answer, data: { date: today, count: todays.length, byStatus, appointments: todays } };
}

function buildKpisAnswer(report: FinancialIntelligenceReport): { answer: string; data: Record<string, unknown> } {
  const k = report.kpis;
  const answer = [
    'المؤشرات المالية للفترة المطلوبة:',
    `• الإيراد: ${fmt(k.revenue)} — المحصّل: ${fmt(k.collected)} (نسبة تحصيل ${fmt(k.collectionRate)}%).`,
    `• المستحقات القائمة: ${fmt(k.outstanding)} (فئة 90+ تمثل ${fmt(k.overdue90Share)}%).`,
    `• الاستردادات: ${fmt(k.refunds)} — المصروفات: ${fmt(k.expenses)} (${fmt(k.expenseRatio)}% من الإيراد).`,
    `• صافي المركز: ${fmt(k.netPosition)} (هامش ${fmt(k.netMargin)}%) — صافي التدفق النقدي: ${fmt(k.netCash)}.`,
  ].join('\n');
  return { answer, data: { kpis: k } };
}

function buildReceivablesAnswer(report: FinancialIntelligenceReport): { answer: string; data: Record<string, unknown> } {
  const r = report.receivables;
  const top = r.topOverdue.slice(0, 3).map((t) => `• ${t.invoiceNumber} — ${fmt(t.balance)} [${t.bucket}]`);
  const buckets = r.buckets.map((b) => `${b.bucket}: ${fmt(b.balance)} (${fmt(b.shareOfOutstanding)}%)`).join(' · ');
  const answer = [
    `المستحقات القائمة: ${fmt(r.totalOutstanding)}.`,
    `التوزيع: ${buckets}`,
    r.averageAgeDays !== null ? `متوسط عمر الفاتورة: ${fmt(r.averageAgeDays)} يومًا.` : '',
    r.topOverdue.length ? `أعلى الفواتير تأخرًا:\n${top.join('\n')}` : '',
    r.overdue90Share !== null && r.overdue90Share > 50 ? '⚠ تركّز عالٍ في فئة 90+ — راجع خطة التحصيل.' : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { answer, data: { receivables: r } };
}
function buildCashFlowAnswer(report: FinancialIntelligenceReport): { answer: string; data: Record<string, unknown> } {
  const t = report.cashTrends;
  const last = t[t.length - 1];
  const answer = last
    ? [
        `آخر شهر متاح (${last.month}): تدفقات داخلة ${fmt(last.inflows)} — خارجة ${fmt(last.outflows)} — صافي ${fmt(last.net)}.`,
        `عدد الأشهر المتاحة في الفترة: ${t.length}.`,
        `صافي التدفق النقدي للفترة كاملة: ${fmt(report.kpis.netCash)}.`,
      ].join('\n')
    : 'لا توجد بيانات تدفق نقدي للفترة المطلوبة.';
  return { answer, data: { cashTrends: t, netCashPeriod: report.kpis.netCash } };
}

function buildAnomaliesAnswer(report: FinancialIntelligenceReport): { answer: string; data: Record<string, unknown> } {
  const a = report.anomalies;
  if (a.length === 0) {
    return { answer: 'لا توجد حالات شاذة وفق العتبات الموثقة (FI_THRESHOLDS) للفترة المطلوبة.', data: { anomalies: [] } };
  }
  const lines = a.slice(0, 5).map((x) => `• [${x.severity}] ${x.label}${x.month ? ` — ${x.month}` : ''}: ${x.detail}`);
  return {
    answer: `تم رصد ${a.length} حالة تستحق المراجعة:\n${lines.join('\n')}\nهذه معلومات استشارية فقط — لا يُنفَّذ أي إجراء تلقائيًا.`,
    data: { anomalies: a },
  };
}

function buildRecommendationsAnswer(report: FinancialIntelligenceReport): { answer: string; data: Record<string, unknown> } {
  const recs = report.recommendations;
  if (recs.length === 0) {
    return { answer: 'لا توجد توصيات حالية — المؤشرات المالية داخل النطاقات الطبيعية.', data: { recommendations: [] } };
  }
  const lines = recs.map((r) => `• [${r.severity}] ${r.message}`);
  return { answer: `توصيات استشارية (لا تُنفَّذ تلقائيًا):\n${lines.join('\n')}`, data: { recommendations: recs } };
}

function buildOperationsAnswer(o: OperationsAnalytics): { answer: string; data: Record<string, unknown> } {
  const answer = [
    `تحليلات التشغيل للفترة ${o.period.from} → ${o.period.to}:`,
    `• القمع: ${JSON.stringify(o.funnel ?? {})}.`,
    `• الاستغلال: ${JSON.stringify(o.schedule ?? {})}.`,
    TOMORROW_HINT,
  ].join('\n');
  return { answer, data: { operations: o as unknown as Record<string, unknown> } };
}

function buildPatientBalanceAnswer(aging: AgingSummary, patientId: string): { answer: string; data: Record<string, unknown> } {
  const rows = aging.rows as Array<Record<string, unknown>>;
  const invoices = rows.filter((r) => Number(r.balance_amount ?? 0) > 0).length;
  const answer = `رصيد المريض ${patientId}: إجمالي مستحق ${fmt(aging.totalOutstanding)} عبر ${invoices} فاتورة غير مسددة.\n${TOMORROW_HINT}`;
  return { answer, data: { patientId, aging: { totalOutstanding: aging.totalOutstanding, buckets: aging.buckets } } };
}

const HELP_ANSWER = [
  'أنا المساعد التشغيلي للعيادة (استشاري، قراءة فقط). يمكنني الإجابة عن:',
  '• مواعيد اليوم — «مواعيد اليوم»',
  '• تحليلات التشغيل — «تحليلات التشغيل»',
  '• المؤشرات المالية — «المؤشرات المالية» / «الإيراد» (يتطلب صلاحية مالية)',
  '• المستحقات والمتأخرات — «المستحقات» (يتطلب صلاحية مالية)',
  '• التدفق النقدي — «التدفق النقدي» (يتطلب صلاحية مالية)',
  '• الحالات الشاذة — «حالات شاذة» (يتطلب صلاحية مالية)',
  '• التوصيات — «توصيات» (يتطلب صلاحية مالية)',
  '• رصيد مريض — «رصيد مريض» + معرف المريض (يتطلب صلاحية مالية)',
  'لا أنفذ أي إجراء (لا مواعيد ولا مدفوعات ولا refunds).',
].join('\n');
// ---------------------------------------------------------------------------
// Orchestrator — routes an authorized staff question to authorized services.
// Throws 'FORBIDDEN_TOOL' when the role lacks the finance-read matrix.
// ---------------------------------------------------------------------------
export type RunAssistantInput = {
  clinicId: string;
  role: string;
  question: string;
  patientId?: string | null;
  /** Optional clinic-local business date override (YYYY-MM-DD); defaults to server date. */
  today?: string;
  fromMonth?: string;
  toMonth?: string;
};

export async function runClinicAssistant(input: RunAssistantInput): Promise<ClinicAssistantAnswer> {
  const { clinicId, role, question } = input;
  const intent = classifyAssistantIntent(question);
  if (!toolAllowed(role, intent.tool)) {
    throw new Error('FORBIDDEN_TOOL');
  }
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const sources: string[] = [];
  let answer: string;
  let data: Record<string, unknown> | null = null;

  switch (intent.tool) {
    case 'today_appointments': {
      sources.push('appointments (authorized service)');
      const rows = await getAppointments(clinicId);
      const built = buildTodayAppointmentsAnswer(rows, today);
      answer = built.answer;
      data = built.data;
      break;
    }
    case 'operations': {
      sources.push('operationsAnalytics (authorized service)');
      const o = await getOperationsAnalytics(clinicId);
      const built = buildOperationsAnswer(o);
      answer = built.answer;
      data = built.data;
      break;
    }
    case 'financial_kpis':
    case 'receivables':
    case 'cash_flow':
    case 'anomalies':
    case 'recommendations': {
      sources.push('financialIntelligence → financial_period_summary / cash_flow_summary / receivable_aging');
      const report = await getFinancialIntelligence(clinicId, {
        fromMonth: input.fromMonth,
        toMonth: input.toMonth,
      });
      const built =
        intent.tool === 'financial_kpis'
          ? buildKpisAnswer(report)
          : intent.tool === 'receivables'
            ? buildReceivablesAnswer(report)
            : intent.tool === 'cash_flow'
              ? buildCashFlowAnswer(report)
              : intent.tool === 'anomalies'
                ? buildAnomaliesAnswer(report)
                : buildRecommendationsAnswer(report);
      answer = built.answer;
      data = built.data;
      break;
    }
    case 'patient_balance': {
      const patientId = input.patientId ?? null;
      if (!patientId) throw new Error('PATIENT_ID_REQUIRED');
      sources.push('accounting.getAgingSummary → receivable_aging');
      const aging = await getAgingSummary(clinicId, patientId);
      const built = buildPatientBalanceAnswer(aging, patientId);
      answer = built.answer;
      data = built.data;
      break;
    }
    default:
      answer = HELP_ANSWER;
      break;
  }

  return {
    clinicId,
    tool: intent.tool,
    role,
    answer,
    data,
    sources,
    meta: {
      generatedAt: new Date().toISOString(),
      deterministic: true,
      readOnly: true,
      executedActions: [],
      aiInterpretation: 'not-used (deterministic output)',
    },
  };
}



