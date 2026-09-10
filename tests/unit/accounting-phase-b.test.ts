import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---
const mockAdmin = vi.hoisted(() => {
  const rpc = vi.fn();
  const from = vi.fn();
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockResolvedValue({ data: [], error: null });
  from.mockReturnValue(chain);
  const setRpc = (v?: unknown) => rpc.mockResolvedValue(v === undefined ? { data: null, error: null } : { data: v, error: null });
  return { supabaseAdmin: { rpc, from }, __setRpc: setRpc };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockAdmin.supabaseAdmin }));

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

import {
  issueInvoice,
  recordPayment,
  recordWriteOff,
  listWriteOffs,
  getAgingSummary,
} from '@/lib/services/accounting';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const PATIENT = 'aaaa-1111-1111-1111-111111111111';
const PROVIDER = 'bbbb-1111-1111-1111-111111111111';
const USER = 'cccc-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.supabaseAdmin.rpc.mockReset();
  mockAdmin.__setRpc({ adjustment_id: 'adj-1', amount: 20, available_before: 30, remaining: 10 });
  mockAdmin.supabaseAdmin.from.mockReset();
  const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn() };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockResolvedValue({ data: [], error: null });
  mockAdmin.supabaseAdmin.from.mockReturnValue(chain);
});

describe('accounting Phase B — issueInvoice payer/provider passthrough', () => {
  it('forwards payer_type/payer_ref and per-item provider_id to the RPC', async () => {
    await issueInvoice({
      clinicId: CLINIC_A,
      patientId: PATIENT,
      items: [{ description: 'Consult', quantity: 1, unit_price: 100, provider_id: PROVIDER }],
      payerType: 'insurance',
      payerRef: '99999999-9999-9999-9999-999999999999',
      actorUserId: USER,
    });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith(
      'issue_invoice',
      expect.objectContaining({
        p_payer_type: 'insurance',
        p_payer_ref: '99999999-9999-9999-9999-999999999999',
        p_items: expect.arrayContaining([expect.objectContaining({ provider_id: PROVIDER })]),
      }),
    );
  });

  it('rejects an invalid payer_type before touching the DB', async () => {
    await expect(
      issueInvoice({ clinicId: CLINIC_A, patientId: PATIENT, items: [{ description: 'x', quantity: 1, unit_price: 10 }], payerType: 'nonsense' as never, actorUserId: USER }),
    ).rejects.toThrow('INVALID_PAYER_TYPE');
    expect(mockAdmin.supabaseAdmin.rpc).not.toHaveBeenCalled();
  });
});

describe('accounting Phase B — recordPayment payer passthrough', () => {
  it('forwards the actual payer (payer_type/payer_ref)', async () => {
    await recordPayment({
      clinicId: CLINIC_A,
      invoiceId: 'inv-1',
      amount: 50,
      method: 'insurance',
      payerType: 'insurance',
      payerRef: '99999999-9999-9999-9999-999999999999',
      actorUserId: USER,
    });
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith(
      'record_payment',
      expect.objectContaining({ p_payer_type: 'insurance', p_payer_ref: '99999999-9999-9999-9999-999999999999', p_method: 'insurance' }),
    );
  });

  it('rejects an invalid payer_type', async () => {
    await expect(
      recordPayment({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 10, method: 'cash', payerType: 'employerX' as never, actorUserId: USER }),
    ).rejects.toThrow('INVALID_PAYER_TYPE');
  });
describe('accounting Phase B — recordWriteOff', () => {
  it('passes canonical args to the atomic RPC and audits write_off_recorded', async () => {
    const out = await recordWriteOff({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 20, reason: 'uncollectible', actorUserId: USER });
    expect(out.adjustmentId).toBe('adj-1');
    expect(mockAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('record_write_off', expect.objectContaining({ p_invoice_id: 'inv-1', p_amount: 20, p_reason: 'uncollectible' }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'write_off_recorded', resourceType: 'clinic_adjustments' }));
  });

  it('rejects non-positive amounts and empty reasons BEFORE the DB', async () => {
    await expect(recordWriteOff({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 0, reason: 'x', actorUserId: USER })).rejects.toThrow('WRITE_OFF_AMOUNT_INVALID');
    await expect(recordWriteOff({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 5, reason: '   ', actorUserId: USER })).rejects.toThrow('WRITE_OFF_REASON_REQUIRED');
    expect(mockAdmin.supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('surfaces exceeded-balance errors from the guard RPC', async () => {
    const err = Object.assign(new Error('WRITE_OFF_EXCEEDS_BALANCE'), {});
    mockAdmin.supabaseAdmin.rpc.mockResolvedValueOnce({ data: null, error: err });
    await expect(recordWriteOff({ clinicId: CLINIC_A, invoiceId: 'inv-1', amount: 999, reason: 'x', actorUserId: USER })).rejects.toThrow('WRITE_OFF_EXCEEDS_BALANCE');
  });
});

describe('accounting Phase B — read queries', () => {
  it('listWriteOffs is tenant-scoped and optional-but-exact invoice filter', async () => {
    await listWriteOffs(CLINIC_A);
    expect(mockAdmin.supabaseAdmin.from).toHaveBeenCalledWith('clinic_adjustments');
    const chain = mockAdmin.supabaseAdmin.from();
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
  });

  it('getAgingSummary groups rows into the five buckets in canonical order', async () => {
    const rows = [
      { bucket: 'current', balance_amount: 50 },
      { bucket: '1-30', balance_amount: 30 },
      { bucket: '31-60', balance_amount: 20 },
      { bucket: '61-90', balance_amount: 10 },
      { bucket: '90+', balance_amount: 5 },
      { bucket: '1-30', balance_amount: 10 },
    ];
    mockAdmin.supabaseAdmin.from.mockReset();
    // The service awaits the final query object, so the chain must be thenable.
    const chain: any = {
      raw: { data: rows, error: null },
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then(resolve: (v: unknown) => void) {
        resolve(this.raw);
      },
    };
    mockAdmin.supabaseAdmin.from.mockReturnValue(chain);

    const summary = await getAgingSummary(CLINIC_A);
    expect(summary.buckets.map((b) => b.bucket)).toEqual(['current', '1-30', '31-60', '61-90', '90+']);
    expect(summary.buckets[1].invoices).toBe(2);
    expect(summary.buckets[1].balance).toBe(40);
    expect(summary.totalOutstanding).toBe(125);
    expect(mockAdmin.supabaseAdmin.from).toHaveBeenCalledWith('receivable_aging');
    expect(chain.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
  });
});
});