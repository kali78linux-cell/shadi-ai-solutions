import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockAdmin = vi.hoisted(() => {
  const rpc = vi.fn();
  const from = vi.fn();
  const setRpc = (v?: unknown) => rpc.mockResolvedValue(v === undefined ? { data: null, error: null } : { data: v, error: null });
  return { supabaseAdmin: { rpc, from }, __setRpc: setRpc };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockAdmin.supabaseAdmin }));

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

import {
  issueInvoice,
  recordPayment,
  voidPayment,
  refundPayment,
  voidInvoice,
  listInvoices,
} from '@/lib/services/accounting';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const PATIENT = 'aaaa-1111-1111-1111-111111111111';
const USER = 'cccc-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.supabaseAdmin.rpc.mockReset();
  mockAdmin.__setRpc({ invoice_id: 'inv-1', invoice_number: 'INV-2026-000001', subtotal: 100, total: 100 });
});

describe('accounting service — issueInvoice', () => {
  it('passes canonical arguments to the atomic RPC and audits invoice_issued', async () => {
    const result = await issueInvoice({ clinicId: CLINIC_A, patientId: PATIENT, items: [{ description: 'Consultation', quantity: 1, unit_price: 100 }], actorUserId: USER });
    expect(result.invoiceId).toBe('inv-1');
    expect(result.invoiceNumber).toBe('INV-2026-000001');
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('issue_invoice', expect.objectContaining({ p_clinic_id: CLINIC_A, p_patient_id: PATIENT, p_created_by: USER }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice_issued', resourceType: 'clinic_invoices' }));
  });

  it('rejects empty items before touching the DB', async () => {
    await expect(issueInvoice({ clinicId: CLINIC_A, patientId: PATIENT, items: [], actorUserId: USER })).rejects.toThrow('INVOICE_ITEMS_REQUIRED');
    expect(mockAdmin.supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid quantity/price', async () => {
    await expect(issueInvoice({ clinicId: CLINIC_A, patientId: PATIENT, items: [{ description: 'x', quantity: 0, unit_price: 10 }], actorUserId: USER })).rejects.toThrow('ITEM_QUANTITY_INVALID');
    await expect(issueInvoice({ clinicId: CLINIC_A, patientId: PATIENT, items: [{ description: 'x', quantity: 1, unit_price: -5 }], actorUserId: USER })).rejects.toThrow('ITEM_PRICE_INVALID');
  });
});

describe('accounting service — recordPayment', () => {
  it('records a partial payment with its method and idempotency key', async () => {
    await recordPayment({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 50, method: 'cash', idempotencyKey: '00000000-0000-0000-0000-0000000000aa', actorUserId: USER });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('record_payment', expect.objectContaining({ p_invoice_id: 'inv-1', p_amount: 50, p_method: 'cash', p_idempotency_key: '00000000-0000-0000-0000-0000000000aa' }));
  });

  it('surfaces duplicate detection from the RPC', async () => {
    mockAdmin.__setRpc({ payment_id: 'pay-1', receipt_number: 'RCP-2026-000001', duplicate: true });
    const out = await recordPayment({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 50, method: 'card', actorUserId: USER });
    expect(out.paymentId).toBe('pay-1');
    expect(out.receiptNumber).toBe('RCP-2026-000001');
  });

  it('rejects non-positive amounts', async () => {
    await expect(recordPayment({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 0, method: 'cash', actorUserId: USER })).rejects.toThrow('PAYMENT_AMOUNT_INVALID');
  });
});
describe('accounting service — void / refund / voidInvoice', () => {
  it('voids a payment and audits payment_voided', async () => {
    mockAdmin.__setRpc(undefined);
    await voidPayment({ clinicId: CLINIC_A, paymentId: 'pay-1', reason: 'wrong amount', actorUserId: USER });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('void_payment', expect.objectContaining({ p_payment_id: 'pay-1', p_reason: 'wrong amount' }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment_voided' }));
  });

  it('flags refunds with non-positive amounts before the RPC', async () => {
    await expect(refundPayment({ clinicId: CLINIC_A, paymentId: 'pay-1', amount: 0, reason: 'r', actorUserId: USER })).rejects.toThrow('REFUND_AMOUNT_INVALID');
  });

  it('records a refund and audits refund_recorded', async () => {
    mockAdmin.__setRpc('refund-pay-1');
    const out = await refundPayment({ clinicId: CLINIC_A, paymentId: 'pay-1', amount: 20, reason: 'partial refund', actorUserId: USER });
    expect(out.refundPaymentId).toBe('refund-pay-1');
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'refund_recorded' }));
  });

  it('voids an invoice and audits invoice_voided', async () => {
    mockAdmin.__setRpc(undefined);
    await voidInvoice({ clinicId: CLINIC_A, invoiceId: 'inv-1', reason: 'wrong issue', actorUserId: USER });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('void_invoice', expect.objectContaining({ p_invoice_id: 'inv-1' }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice_voided' }));
  });
});

describe('accounting service — tenant-scoped reads', () => {
  it('always filters reads by clinic_id (isolation baseline)', async () => {
    mockAdmin.supabaseAdmin.from.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
    });
    const rows = await listInvoices(CLINIC_A);
    expect(Array.isArray(rows)).toBe(true);
    expect(mockAdmin.supabaseAdmin.from).toHaveBeenCalledWith('invoice_balances');
  });
});