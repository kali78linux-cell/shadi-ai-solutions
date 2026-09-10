import { describe, it, expect, vi, beforeEach } from 'vitest';

// Harness mirrors clinic-setup-api: fresh chainable+thenable builder per
// .from(table); rpc resolves per-call results.
const mockSupabaseAdmin = vi.hoisted(() => {
  function makeBuilder(result: { data: unknown; error: unknown }) {
    const b: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit', 'single', 'maybeSingle'];
    for (const m of CHAIN) b[m] = vi.fn(() => b);
    b.then = (resolve: (v: unknown) => void) => resolve(result);
    return b;
  }
  const supabaseAdmin = {
    from: vi.fn(() => makeBuilder({ data: [], error: null })),
    rpc: vi.fn(async () => ({ data: {}, error: null })),
  };
  return { supabaseAdmin };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

import {
  createPayer,
  updatePayer,
  createPatientCoverage,
  createClaim,
  settleClaim,
  submitClaim,
  rejectClaim,
} from '@/lib/services/insurance';

const CLINIC = '11111111-1111-1111-1111-111111111111';

describe('payers (D-I1/D-I4 directory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a payer and writes an audit entry', async () => {
    const builder: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'update', 'eq', 'single'];
    for (const m of CHAIN) builder[m] = vi.fn(() => builder);
    builder.then = (resolve: (v: unknown) => void) =>
      resolve({ data: { id: 'pay1', name: 'Grand Insurance', payer_type: 'insurance', is_active: true }, error: null });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);

    const res = await createPayer({ clinicId: CLINIC, name: ' Grand Insurance ', payerType: 'insurance', actorUserId: 'u1' });
    expect(res.id).toBe('pay1');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: CLINIC, name: 'Grand Insurance', payer_type: 'insurance',
    }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'insurance.payer.created' }));
  });

  it('rejects empty payer name before any write', async () => {
    await expect(createPayer({ clinicId: CLINIC, name: '  ', payerType: 'insurance', actorUserId: 'u1' }))
      .rejects.toThrow('PAYER_NAME_REQUIRED');
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it('updatePayer scopes by clinic_id + payer id (tenant-safe patch)', async () => {
    const builder: Record<string, any> = {};
    const CHAIN = ['select', 'insert', 'update', 'eq', 'single'];
    for (const m of CHAIN) builder[m] = vi.fn(() => builder);
    builder.then = (resolve: (v: unknown) => void) => resolve({ data: { id: 'pay1', is_active: false }, error: null });
    (mockSupabaseAdmin.supabaseAdmin.from as any).mockReturnValueOnce(builder);

    await updatePayer({ clinicId: CLINIC, payerId: 'pay1', isActive: false, actorUserId: 'u1' });
    expect(builder.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(builder.eq).toHaveBeenCalledWith('id', 'pay1');
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });
});

describe('coverages (D-I3 configuration only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty policy number before any write', async () => {
    await expect(createPatientCoverage({
      clinicId: CLINIC, patientId: 'p1', payerId: 'pay1',
      policyNumber: '', effectiveFrom: '2026-01-01', actorUserId: 'u1',
    })).rejects.toThrow('POLICY_NUMBER_REQUIRED');
    expect(mockSupabaseAdmin.supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe('claims lifecycle (D-I2 via RPCs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createClaim calls create_insurance_claim RPC with full payload', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({
      data: { claim_id: 'c1', claim_number: 'CLM-2026-000001', status: 'draft', duplicate: false },
      error: null,
    });
    const res = await createClaim({
      clinicId: CLINIC, patientId: 'p1', payerId: 'pay1', invoiceId: 'inv1',
      claimedAmount: 100, actorUserId: 'u1', idempotencyKey: 'k1',
    });
    expect(res.claim_number).toBe('CLM-2026-000001');
    expect(mockSupabaseAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('create_insurance_claim', expect.objectContaining({
      p_clinic_id: CLINIC, p_idempotency_key: 'k1',
    }));
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'insurance.claim.created' }));
  });

  it('createClaim surfaces RPC errors', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'CLAIM_EXCEEDS_INVOICE' } });
    await expect(createClaim({
      clinicId: CLINIC, patientId: 'p1', payerId: 'pay1', invoiceId: 'inv1',
      claimedAmount: 999999, actorUserId: 'u1',
    })).rejects.toThrow('CLAIM_EXCEEDS_INVOICE');
  });

  it('submitClaim routes to submit_insurance_claim', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: { claim_id: 'c1', status: 'submitted' }, error: null });
    const res = await submitClaim({ clinicId: CLINIC, claimId: 'c1', actorUserId: 'u1' });
    expect(res.status).toBe('submitted');
    expect(mockSupabaseAdmin.supabaseAdmin.rpc).toHaveBeenCalledWith('submit_insurance_claim', expect.any(Object));
  });

  it('settleClaim routes to settle_insurance_claim and audits non-cash note', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({
      data: { claim_id: 'c1', status: 'settled', settled_amount: 80, duplicate: false }, error: null,
    });
    const res = await settleClaim({ clinicId: CLINIC, claimId: 'c1', settledAmount: 80, actorUserId: 'u1' });
    expect(res.settled_amount).toBe(80);
    expect(mockAudit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'insurance.claim.settled',
      metadata: expect.objectContaining({ note: expect.stringContaining('not a cash movement') }),
    }));
  });

  it('rejectClaim requires a reason (service-side contract)', async () => {
    (mockSupabaseAdmin.supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'REJECTION_REASON_REQUIRED' } });
    await expect(rejectClaim({ clinicId: CLINIC, claimId: 'c1', reason: '   ', actorUserId: 'u1' }))
      .rejects.toThrow('REJECTION_REASON_REQUIRED');
  });
});
