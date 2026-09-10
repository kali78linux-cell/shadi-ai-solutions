// STEP 2 — Accounting Phase A: Patient Finance service layer.
// Server-only. All financial mutations go through the atomic DB RPCs
// (issue_invoice / record_payment / void_payment / refund_payment / void_invoice)
// which enforce the financial invariants (insert-only, void-not-delete,
// derived balances, tenant-scoped composite FKs) at the database level.
// Platform Billing (subscriptions/billing_plans/Stripe) is never touched here.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeAuditLog } from '@/lib/services/auditService';

export type InvoiceItemInput = {
  service_id?: string | null;
  provider_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
};

export type IssueInvoiceInput = {
  clinicId: string;
  patientId: string;
  appointmentId?: string | null;
  items: InvoiceItemInput[];
  discount?: number;
  tax?: number;
  notes?: string | null;
  dueAt?: string | null;
  payerType?: 'patient' | 'insurance' | 'employer' | 'third_party' | null;
  payerRef?: string | null;
  actorUserId: string | null;
};

export type RecordPaymentInput = {
  clinicId: string;
  invoiceId: string;
  amount: number;
  method: 'cash' | 'card' | 'bank_transfer' | 'insurance' | 'other';
  reference?: string | null;
  idempotencyKey?: string | null;
  payerType?: 'patient' | 'insurance' | 'employer' | 'third_party' | null;
  payerRef?: string | null;
  actorUserId: string | null;
};

export type InvoiceWithItems = Record<string, unknown> & {
  items: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
};

function invalidParams(input: IssueInvoiceInput): string | null {
  if (!input.items || input.items.length === 0) return 'INVOICE_ITEMS_REQUIRED';
  for (const item of input.items) {
    if (!item.description || item.description.trim().length === 0) return 'ITEM_DESCRIPTION_REQUIRED';
    if (!(item.quantity > 0)) return 'ITEM_QUANTITY_INVALID';
    if (!(item.unit_price >= 0)) return 'ITEM_PRICE_INVALID';
  }
  if ((input.discount ?? 0) < 0) return 'DISCOUNT_INVALID';
  if ((input.tax ?? 0) < 0) return 'TAX_INVALID';
  if (input.payerType != null && !['patient', 'insurance', 'employer', 'third_party'].includes(input.payerType)) return 'INVALID_PAYER_TYPE';
  return null;
}

/** Issues an invoice (directly as `issued` — no draft in Phase A). */
export async function issueInvoice(input: IssueInvoiceInput): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const bad = invalidParams(input);
  if (bad) throw new Error(bad);

  const { data, error } = await supabaseAdmin.rpc('issue_invoice', {
    p_clinic_id: input.clinicId,
    p_patient_id: input.patientId,
    p_appointment_id: input.appointmentId ?? null,
    p_items: input.items.map((item) => ({
      service_id: item.service_id ?? null,
      provider_id: item.provider_id ?? null,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
    p_discount: input.discount ?? 0,
    p_tax: input.tax ?? 0,
    p_notes: input.notes ?? null,
    p_due_at: input.dueAt ?? null,
    p_created_by: input.actorUserId,
    p_payer_type: input.payerType ?? null,
    p_payer_ref: input.payerRef ?? null,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'invoice_issued',
    resourceType: 'clinic_invoices',
    resourceId: data?.invoice_id,
    metadata: { invoice_number: data?.invoice_number },
  });
  return { invoiceId: data?.invoice_id, invoiceNumber: data?.invoice_number };
}

/** Records a payment (full/partial/multiple; overpayment allowed → patient credit). */
export async function recordPayment(input: RecordPaymentInput): Promise<{ paymentId: string; receiptNumber: string | null }> {
  if (!(input.amount > 0)) throw new Error('PAYMENT_AMOUNT_INVALID');
  if (input.payerType != null && !['patient', 'insurance', 'employer', 'third_party'].includes(input.payerType)) throw new Error('INVALID_PAYER_TYPE');
  const { data, error } = await supabaseAdmin.rpc('record_payment', {
    p_clinic_id: input.clinicId,
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_method: input.method,
    p_reference: input.reference ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_recorded_by: input.actorUserId,
    p_payer_type: input.payerType ?? null,
    p_payer_ref: input.payerRef ?? null,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'payment_recorded',
    resourceType: 'clinic_payments',
    resourceId: data?.payment_id,
    metadata: { invoice_id: input.invoiceId, amount: input.amount, method: input.method, duplicate: Boolean(data?.duplicate) },
  });
  return { paymentId: data?.payment_id, receiptNumber: data?.receipt_number ?? null };
}

export type VoidPaymentInput = {
  clinicId: string;
  paymentId: string;
  reason: string;
  actorUserId: string | null;
};

/** Voids a recorded payment (kept in ledger; excluded from paid totals). */
export async function voidPayment(input: VoidPaymentInput): Promise<void> {
  const { error } = await supabaseAdmin.rpc('void_payment', {
    p_clinic_id: input.clinicId,
    p_payment_id: input.paymentId,
    p_reason: input.reason,
    p_voided_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'payment_voided',
    resourceType: 'clinic_payments',
    resourceId: input.paymentId,
    metadata: { reason: input.reason },
  });
}

export type RefundPaymentInput = {
  clinicId: string;
  paymentId: string;
  amount: number;
  reason: string;
  actorUserId: string | null;
};

/** Records a refund against a recorded payment (capped at the net paid amount). */
export async function refundPayment(input: RefundPaymentInput): Promise<{ refundPaymentId: string }> {
  if (!(input.amount > 0)) throw new Error('REFUND_AMOUNT_INVALID');
  const { data, error } = await supabaseAdmin.rpc('refund_payment', {
    p_clinic_id: input.clinicId,
    p_payment_id: input.paymentId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_refunded_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'refund_recorded',
    resourceType: 'clinic_payments',
    resourceId: data,
    metadata: { original_payment_id: input.paymentId, amount: input.amount, reason: input.reason },
  });
  return { refundPaymentId: data as string };
}

export type VoidInvoiceInput = {
  clinicId: string;
  invoiceId: string;
  reason: string;
  actorUserId: string | null;
};

/** Voids an issued invoice (kept + numbered; no payments can attach afterwards). */
export async function voidInvoice(input: VoidInvoiceInput): Promise<void> {
  const { error } = await supabaseAdmin.rpc('void_invoice', {
    p_clinic_id: input.clinicId,
    p_invoice_id: input.invoiceId,
    p_reason: input.reason,
    p_voided_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'invoice_voided',
    resourceType: 'clinic_invoices',
    resourceId: input.invoiceId,
    metadata: { reason: input.reason },
  });
}

// --- Read-only queries (derived balances — never stored numbers) ---

export async function listInvoices(clinicId: string, patientId?: string | null) {
  let query = supabaseAdmin
    .from('invoice_balances')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('invoice_number', { ascending: false });
  if (patientId) query = query.eq('patient_id', patientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getInvoiceDetail(clinicId: string, invoiceId: string): Promise<InvoiceWithItems | null> {
  const [invRes, itemsRes, payRes] = await Promise.all([
    supabaseAdmin.from('clinic_invoices').select('*').eq('clinic_id', clinicId).eq('id', invoiceId).maybeSingle(),
    supabaseAdmin.from('invoice_items').select('*').eq('clinic_id', clinicId).eq('invoice_id', invoiceId).order('created_at'),
    supabaseAdmin.from('clinic_payments').select('*').eq('clinic_id', clinicId).eq('invoice_id', invoiceId).order('created_at'),
  ]);
  if (invRes.error) throw new Error(invRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (payRes.error) throw new Error(payRes.error.message);
  if (!invRes.data) return null;
  return { ...invRes.data, items: itemsRes.data ?? [], payments: payRes.data ?? [] };
}

export async function listPayments(clinicId: string, invoiceId?: string | null) {
  let query = supabaseAdmin
    .from('clinic_payments')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false });
  if (invoiceId) query = query.eq('invoice_id', invoiceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPatientBalances(clinicId: string, patientId?: string | null) {
  let query = supabaseAdmin.from('patient_balances').select('*').eq('clinic_id', clinicId);
  if (patientId) query = query.eq('patient_id', patientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}
// --- Accounting Phase B: write-offs (D-B2) + aging (D-B5) ---

export type RecordWriteOffInput = {
  clinicId: string;
  invoiceId: string;
  amount: number;
  reason: string;
  idempotencyKey?: string | null;
  actorUserId: string | null;
};

export type WriteOffResult = {
  adjustmentId: string;
  amount: number;
  availableBefore: number;
  remaining: number;
};

/** Records a write-off against the current available invoice balance. */
export async function recordWriteOff(input: RecordWriteOffInput): Promise<WriteOffResult> {
  if (!(input.amount > 0)) throw new Error('WRITE_OFF_AMOUNT_INVALID');
  if (!input.reason || input.reason.trim().length === 0) throw new Error('WRITE_OFF_REASON_REQUIRED');
  const { data, error } = await supabaseAdmin.rpc('record_write_off', {
    p_clinic_id: input.clinicId,
    p_invoice_id: input.invoiceId,
    p_amount: input.amount,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_recorded_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'write_off_recorded',
    resourceType: 'clinic_adjustments',
    resourceId: data?.adjustment_id,
    metadata: { invoice_id: input.invoiceId, amount: input.amount, reason: input.reason },
  });
  return {
    adjustmentId: data?.adjustment_id,
    amount: Number(data?.amount ?? input.amount),
    availableBefore: Number(data?.available_before ?? 0),
    remaining: Number(data?.remaining ?? 0),
  };
}

export type WriteOffRow = Record<string, unknown>;

export async function listWriteOffs(clinicId: string, invoiceId?: string | null) {
  let query = supabaseAdmin
    .from('clinic_adjustments')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false });
  if (invoiceId) query = query.eq('invoice_id', invoiceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as WriteOffRow[];
}

export type AgingBucket = {
  bucket: 'current' | '1-30' | '31-60' | '61-90' | '90+';
  invoices: number;
  balance: number;
};

export type AgingSummary = {
  buckets: AgingBucket[];
  totalOutstanding: number;
  rows: Array<Record<string, unknown>>;
};

const AGING_BUCKET_ORDER: AgingBucket['bucket'][] = ['current', '1-30', '31-60', '61-90', '90+'];

/** Derived aging summary for one clinic (read-only, never stored). */
export async function getAgingSummary(clinicId: string, patientId?: string | null): Promise<AgingSummary> {
  let query = supabaseAdmin
    .from('receivable_aging')
    .select('*')
    .eq('clinic_id', clinicId);
  if (patientId) query = query.eq('patient_id', patientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const buckets = AGING_BUCKET_ORDER.map((bucket) => ({
    bucket,
    invoices: rows.filter((r) => r.bucket === bucket).length,
    balance: rows
      .filter((r) => r.bucket === bucket)
      .reduce((sum, r) => sum + Number(r.balance_amount ?? 0), 0),
  }));
  const totalOutstanding = rows.reduce((sum, r) => sum + Number(r.balance_amount ?? 0), 0);
  return { buckets, totalOutstanding, rows };
}

// --- Accounting Phase C: expenses, categories, cash register, daily closing ---

export type ExpenseMethod = 'cash' | 'card' | 'bank_transfer' | 'other';
const EXPENSE_METHODS: ExpenseMethod[] = ['cash', 'card', 'bank_transfer', 'other'];

export type RecordExpenseInput = {
  clinicId: string;
  categoryId?: string | null;
  amount: number;
  method: ExpenseMethod;
  spentAt?: string | null;
  vendor?: string | null;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  actorUserId: string | null;
};

export type ExpenseResult = {
  expenseId: string;
  expenseNumber: string;
  duplicate: boolean;
};

/** Records an immutable expense movement via the atomic `record_expense` RPC. */
export async function recordExpense(input: RecordExpenseInput): Promise<ExpenseResult> {
  if (!(input.amount > 0)) throw new Error('EXPENSE_AMOUNT_INVALID');
  if (!EXPENSE_METHODS.includes(input.method)) throw new Error('EXPENSE_METHOD_INVALID');
  const { data, error } = await supabaseAdmin.rpc('record_expense', {
    p_clinic_id: input.clinicId,
    p_category_id: input.categoryId ?? null,
    p_amount: input.amount,
    p_method: input.method,
    p_spent_at: input.spentAt ?? null,
    p_vendor: input.vendor ?? null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
    p_recorded_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'expense_recorded',
    resourceType: 'clinic_expenses',
    resourceId: data?.expense_id,
    metadata: {
      expense_number: data?.expense_number,
      amount: input.amount,
      method: input.method,
      category_id: input.categoryId ?? null,
      vendor: input.vendor ?? null,
    },
  });
  return {
    expenseId: data?.expense_id,
    expenseNumber: data?.expense_number,
    duplicate: Boolean(data?.duplicate),
  };
}

/** Voids an expense (bookkeeping only — nothing is deleted or mutated). */
export async function voidExpense(input: {
  clinicId: string;
  expenseId: string;
  reason: string;
  actorUserId: string | null;
}): Promise<void> {
  if (!input.reason || input.reason.trim().length === 0) throw new Error('VOID_REASON_REQUIRED');
  const { error } = await supabaseAdmin.rpc('void_expense', {
    p_clinic_id: input.clinicId,
    p_expense_id: input.expenseId,
    p_reason: input.reason,
    p_voided_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'expense_voided',
    resourceType: 'clinic_expenses',
    resourceId: input.expenseId,
    metadata: { reason: input.reason },
  });
}

export type ExpenseRow = Record<string, unknown>;

export async function listExpenses(
  clinicId: string,
  filters?: { categoryId?: string | null; status?: string | null; from?: string | null; to?: string | null }
): Promise<ExpenseRow[]> {
  let query = supabaseAdmin
    .from('clinic_expenses')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('spent_at', { ascending: false });
  if (filters?.categoryId) query = query.eq('category_id', filters.categoryId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.from) query = query.gte('spent_at', filters.from);
  if (filters?.to) query = query.lte('spent_at', filters.to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpenseRow[];
}


export type ExpenseCategoryRow = Record<string, unknown>;

export async function listExpenseCategories(clinicId: string): Promise<ExpenseCategoryRow[]> {
  const { data, error } = await supabaseAdmin
    .from('clinic_expense_categories')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExpenseCategoryRow[];
}

export async function createExpenseCategory(input: {
  clinicId: string;
  name: string;
  actorUserId: string | null;
}): Promise<ExpenseCategoryRow> {
  const name = input.name?.trim();
  if (!name) throw new Error('CATEGORY_NAME_REQUIRED');
  const { data, error } = await supabaseAdmin
    .from('clinic_expense_categories')
    .insert({ clinic_id: input.clinicId, name, created_by: input.actorUserId })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'expense_category_created',
    resourceType: 'clinic_expense_categories',
    resourceId: (data as ExpenseCategoryRow)?.id as string,
    metadata: { name },
  });
  return data as ExpenseCategoryRow;
}

export async function updateExpenseCategory(input: {
  clinicId: string;
  categoryId: string;
  name?: string | null;
  isActive?: boolean | null;
  actorUserId: string | null;
}): Promise<ExpenseCategoryRow> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new Error('CATEGORY_NAME_REQUIRED');
    patch.name = name;
  }
  if (input.isActive != null) patch.is_active = input.isActive;
  const { data, error } = await supabaseAdmin
    .from('clinic_expense_categories')
    .update(patch)
    .eq('clinic_id', input.clinicId)
    .eq('id', input.categoryId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'expense_category_updated',
    resourceType: 'clinic_expense_categories',
    resourceId: input.categoryId,
    metadata: { name: input.name ?? null, is_active: input.isActive ?? null },
  });
  return data as ExpenseCategoryRow;
}

export type CashSessionRow = Record<string, unknown>;

export async function openCashSession(input: {
  clinicId: string;
  openingAmount: number;
  actorUserId: string | null;
}): Promise<{ sessionId: string; openingAmount: number }> {
  if (!(input.openingAmount >= 0)) throw new Error('CASH_OPENING_INVALID');
  const { data, error } = await supabaseAdmin.rpc('open_cash_session', {
    p_clinic_id: input.clinicId,
    p_opening_amount: input.openingAmount,
    p_opened_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'cash_session_opened',
    resourceType: 'clinic_cash_sessions',
    resourceId: data?.session_id,
    metadata: { opening_amount: input.openingAmount },
  });
  return { sessionId: data?.session_id, openingAmount: Number(data?.opening_amount ?? input.openingAmount) };
}


export type CloseCashSessionResult = {
  sessionId: string;
  openingAmount: number;
  cashIn: number;
  cashOut: number;
  expectedClosing: number;
  countedAmount: number;
  variance: number;
};

/**
 * Closes the open cash session. Expected cash is computed by the RPC from
 * EXPLICIT ledger kinds (payment_recorded / refund_recorded / expense_recorded,
 * method='cash') — never from `direction`. Variance is a displayed snapshot
 * only; it is never booked to the ledger (pending documented owner decision).
 */
export async function closeCashSession(input: {
  clinicId: string;
  sessionId: string;
  countedAmount: number;
  notes?: string | null;
  actorUserId: string | null;
}): Promise<CloseCashSessionResult> {
  if (!(input.countedAmount >= 0)) throw new Error('CASH_COUNTED_INVALID');
  const { data, error } = await supabaseAdmin.rpc('close_cash_session', {
    p_clinic_id: input.clinicId,
    p_session_id: input.sessionId,
    p_counted_amount: input.countedAmount,
    p_notes: input.notes ?? null,
    p_closed_by: input.actorUserId,
  });
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'cash_session_closed',
    resourceType: 'clinic_cash_sessions',
    resourceId: input.sessionId,
    metadata: {
      expected_closing: Number(data?.expected_closing ?? 0),
      counted_amount: input.countedAmount,
      variance: Number(data?.variance ?? 0),
    },
  });
  return {
    sessionId: data?.session_id,
    openingAmount: Number(data?.opening_amount ?? 0),
    cashIn: Number(data?.cash_in ?? 0),
    cashOut: Number(data?.cash_out ?? 0),
    expectedClosing: Number(data?.expected_closing ?? 0),
    countedAmount: Number(data?.counted_amount ?? input.countedAmount),
    variance: Number(data?.variance ?? 0),
  };
}

export async function listCashSessions(clinicId: string): Promise<CashSessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('clinic_cash_sessions')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('opened_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CashSessionRow[];
}

export type DailyCashPosition = {
  businessDate: string;
  cashIn: number;
  cashOut: number;
  netCash: number;
};

/** Derived daily cash positions (read-only view — never stored). */
export async function getDailyCashPositions(
  clinicId: string,
  from?: string | null,
  to?: string | null
): Promise<DailyCashPosition[]> {
  let query = supabaseAdmin
    .from('daily_cash_positions')
    .select('*')
    .eq('clinic_id', clinicId)
    .order('business_date', { ascending: false });
  if (from) query = query.gte('business_date', from);
  if (to) query = query.lte('business_date', to);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    businessDate: String(row.business_date),
    cashIn: Number(row.cash_in ?? 0),
    cashOut: Number(row.cash_out ?? 0),
    netCash: Number(row.net_cash ?? 0),
  }));
}

