import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mocks.from(...args) },
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));

import {
  listOwnInvoices,
  getOwnInvoice,
  getOwnBalance,
  listOwnPayments,
  getOwnStatement,
} from '@/lib/services/patientPortal';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const PATIENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const IDENTITY = { id: 'i1', clinic_id: CLINIC, patient_id: PATIENT, email: 'p@x.com' };
const IDENTITY_OTHER = { id: 'i2', clinic_id: CLINIC_B, patient_id: PATIENT_B, email: 'q@x.com' };

function chain() {
  const q: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return q;
}

const INV_ID = '33333333-3333-3333-3333-333333333333';
const INV = [
  {
    invoice_id: INV_ID,
    invoice_number: 'INV-2026-1',
    status: 'issued',
    total: 100,
    paid_amount: 30,
    balance_amount: 70,
  },
];
const INV_META = [{ id: INV_ID, issued_at: '2026-09-01T10:00:00Z', due_at: null, currency: 'JOD' }];
const PAY = [
  {
    id: '44444444-4444-4444-4444-444444444444',
    invoice_id: INV_ID,
    direction: 'payment',
    amount: 30,
    method: 'cash',
    status: 'recorded',
    receipt_number: 'RCP-2026-1',
    created_at: '2026-09-01T12:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
});

describe('portal invoice reads — scope & projection', () => {
  it('listOwnInvoices scopes by identity clinic+patient and projects safe fields', async () => {
    const q = chain();
    q.limit.mockResolvedValueOnce({ data: INV, error: null });
    q.in.mockResolvedValueOnce({ data: INV_META, error: null });
    mocks.from.mockReturnValue(q);
    const rows = await listOwnInvoices(IDENTITY);
    expect(q.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(q.eq).toHaveBeenCalledWith('patient_id', PATIENT);
    expect(JSON.stringify(rows)).not.toContain('voided_by');
    expect(JSON.stringify(rows)).not.toContain('idempotency_key');
    expect(rows[0]).toEqual({
      invoice_id: INV_ID,
      invoice_number: 'INV-2026-1',
      status: 'issued',
      issued_at: '2026-09-01T10:00:00Z',
      due_at: null,
      currency: 'JOD',
      total: 100,
      paid: 30,
      balance: 70,
    });
  });

  it('listOwnInvoices with a different-tenant identity never queries the other clinic', async () => {
    const q = chain();
    q.limit.mockResolvedValueOnce({ data: [], error: null });
    mocks.from.mockReturnValue(q);
    const rows = await listOwnInvoices(IDENTITY_OTHER);
    expect(rows).toEqual([]);
    const eqValues = q.eq.mock.calls.map((c: unknown[]) => c[1]);
    expect(eqValues).not.toContain(CLINIC);
  });

  it('getOwnInvoice returns null for a non-owned invoice (fail-closed, no leak)', async () => {
    const q = chain();
    q.limit.mockResolvedValueOnce({ data: [], error: null });
    mocks.from.mockReturnValue(q);
    expect(await getOwnInvoice(IDENTITY, '99999999-9999-9999-9999-999999999999')).toBeNull();
  });

  it('getOwnInvoice returns items for owned invoice with patient-safe projection', async () => {
    // .from call order: invoice_balances → clinic_invoices(meta) → invoice_items
    const q1 = chain(); q1.limit.mockResolvedValueOnce({ data: INV, error: null });
    const q2 = chain(); q2.in.mockResolvedValueOnce({ data: INV_META, error: null });
    const q3 = chain();
    q3.eq.mockImplementation((col: string) => (col === 'invoice_id'
      ? Promise.resolve({ data: [{ description: 'خدمة', quantity: 1, unit_price: 100, line_total: 100 }], error: null })
      : q3));
    mocks.from
      .mockReturnValueOnce(q1)
      .mockReturnValueOnce(q2)
      .mockReturnValueOnce(q3);
    const inv = await getOwnInvoice(IDENTITY, INV_ID);
    expect(inv?.items[0].line_total).toBe(100);
    expect(JSON.stringify(inv)).not.toContain('provider_id');
  });
});

describe('portal balance & payments — scope & projection', () => {
  it('getOwnBalance reads derived patient_balances scoped by identity', async () => {
    const q = chain();
    q.maybeSingle.mockResolvedValueOnce({
      data: { outstanding_amount: 70, credit_amount: 0, invoiced_total: 100, paid_total: 30, written_off_total: 0 },
      error: null,
    });
    mocks.from.mockReturnValue(q);
    const bal = await getOwnBalance(IDENTITY);
    expect(bal).toEqual({ outstanding: 70, credit: 0, invoiced_total: 100, paid_total: 30, written_off_total: 0 });
    expect(q.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(q.eq).toHaveBeenCalledWith('patient_id', PATIENT);
  });

  it('listOwnPayments scopes via own invoices and excludes voided; no internal metadata', async () => {
    const q = chain();
    // query1: clinic_invoices with terminal eq(patient_id)
    q.eq
      .mockImplementationOnce(() => q) // clinic_id
      .mockResolvedValueOnce({ data: [{ id: INV_ID, invoice_number: 'INV-2026-1' }], error: null }); // patient_id (terminal)
    // query2: clinic_payments terminal = limit
    q.limit.mockResolvedValueOnce({ data: PAY, error: null });
    mocks.from.mockReturnValue(q);
    const rows = await listOwnPayments(IDENTITY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 30, method: 'cash', receipt_number: 'RCP-2026-1', invoice_number: 'INV-2026-1' });
    expect(q.is).toHaveBeenCalledWith('voided_at', null);
    expect(JSON.stringify(rows)).not.toContain('idempotency_key');
    expect(JSON.stringify(rows)).not.toContain('recorded_by');
  });

  it('listOwnPayments returns [] when the patient has no invoices', async () => {
    const q = chain();
    q.eq
      .mockImplementationOnce(() => q) // clinic_id
      .mockResolvedValueOnce({ data: [], error: null }); // patient_id (terminal) — no invoices
    mocks.from.mockReturnValue(q);
    expect(await listOwnPayments(IDENTITY)).toEqual([]);
  });

  it('getOwnStatement composes invoices + payments + balance', async () => {
    // from-call order under Promise.all:
    // 1 invoice_balances (limit) · 2 clinic_invoices-list (eq patient_id) · 3 patient_balances (maybeSingle)
    // 4 clinic_invoices-meta (in) · 5 clinic_payments (limit)
    const q1 = chain(); q1.limit.mockResolvedValueOnce({ data: INV, error: null });
    const q2 = chain();
    q2.eq.mockImplementation((col: string) => (col === 'patient_id'
      ? Promise.resolve({ data: [{ id: INV_ID, invoice_number: 'INV-2026-1' }], error: null })
      : q2));
    const q3 = chain();
    q3.maybeSingle.mockResolvedValueOnce({
      data: { outstanding_amount: 70, credit_amount: 0, invoiced_total: 100, paid_total: 30, written_off_total: 0 },
      error: null,
    });
    const q4 = chain(); q4.in.mockResolvedValueOnce({ data: INV_META, error: null });
    const q5 = chain(); q5.limit.mockResolvedValueOnce({ data: PAY, error: null });
    mocks.from
      .mockReturnValueOnce(q1)
      .mockReturnValueOnce(q2)
      .mockReturnValueOnce(q3)
      .mockReturnValueOnce(q4)
      .mockReturnValueOnce(q5);
    const stmt = await getOwnStatement(IDENTITY);
    expect(stmt.invoices).toHaveLength(1);
    expect(stmt.payments).toHaveLength(1);
    expect(stmt.outstanding).toBe(70);
    expect(stmt.credit).toBe(0);
  });
});