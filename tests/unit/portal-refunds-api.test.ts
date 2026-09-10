import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

/**
 * PP-4 — Admin refund API + webhook integration (mocked provider/supabase).
 * Live DB behavior is verified separately via a self-rollback probe.
 */

const state = vi.hoisted(() => ({
  payment: null as any,
  invoice: null as any,
  paymentsForInvoice: [] as any[],
  trackedRefund: null as any,
  claimed: true as any,
  updates: [] as Array<{ table: string; payload: any; id: string }>,
  inserts: [] as Array<{ table: string; payload: any }>,
  rpcCalls: [] as Array<{ name: string; params: any }>,
  rpcResult: { data: 'refund-row-1', error: null } as any,
}));

const providerFns = vi.hoisted(() => ({
  createRefund: vi.fn(),
  getRefund: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return chain;
        },
        is: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        insert: (payload: any) => {
          state.inserts.push({ table, payload });
          const id = payload?.id ?? `new-${state.inserts.length}`;
          return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
        },
        update: (payload: any) => {
          state.updates.push({ table, payload, id: String(filters.id ?? '') });
          // Reflect the claim/status into the tracked row so a SECOND delivery
          // of the same event sees booked_at already set (idempotency check).
          if (table === 'clinic_payment_refunds' && state.trackedRefund) {
            state.trackedRefund = { ...state.trackedRefund, ...payload };
          }
          return {
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: state.claimed ? { id: 'r1' } : null, error: null }),
                }),
              }),
              select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
              then: (res: (x: unknown) => void) => res({ data: null, error: null }),
            }),
            select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
            then: (res: (x: unknown) => void) => res({ data: null, error: null }),
          };
        },
        maybeSingle: () => ({
          then: (res: (x: unknown) => void) => {
            let row: any = null;
            if (table === 'clinic_payments') row = state.payment;
            else if (table === 'clinic_invoices') row = state.invoice;
            else if (table === 'clinic_payment_refunds') row = state.trackedRefund;
            res({ data: row, error: null });
          },
        }),
        single: () => ({ then: (res: (x: unknown) => void) => res({ data: null, error: null }) }),
        then: (res: (x: unknown) => void) => {
          // computeRefundableAmount: plain list query on clinic_payments.
          let rows: any[] = [];
          if (table === 'clinic_payments') rows = state.paymentsForInvoice;
          res({ data: rows, error: null });
        },
      };
      return chain;
    }),
    rpc: vi.fn((name: string, params: any) => {
      state.rpcCalls.push({ name, params });
      return Promise.resolve(state.rpcResult);
    }),
  },
}));

vi.mock('@/lib/payments/provider', async () => {
  const mod = await vi.importActual<typeof import('@/lib/payments/provider')>('@/lib/payments/provider');
  return { ...mod, getPaymentProvider: () => providerFns };
});
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: vi.fn() }));
vi.mock('@/lib/clinic/localization', () => ({
  loadClinicLocalization: vi.fn(async () => ({ currency: 'ils', timezone: 'Asia/Jerusalem' })),
}));
vi.mock('@/lib/services/clinicAuthorization', () => ({
  authorizeClinicRequest: vi.fn(async () => ({ authorized: true, user: { id: 'u1' }, role: 'owner' })),
  roleDenied: vi.fn((auth: { role?: string }, roles: readonly string[]) =>
    roles.includes(auth.role ?? '') ? null : { authorized: false as const, status: 403 as const }
  ),
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
}));

import { POST as refundPOST } from '@/app/api/clinic/payments/refund/route';
import { POST as webhookPOST } from '@/app/api/payments/webhook/route';

const SECRET = 'whsec_test_00000000000000000000000000000000';
function sign(raw: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`, 'utf8').digest('hex');
  return `t=${ts},v1=${sig}`;
}

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PAYMENT = '55555555-5555-5555-5555-555555555555';
beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_pp4';
  state.payment = {
    id: PAYMENT,
    clinic_id: CLINIC,
    invoice_id: INVOICE,
    direction: 'payment',
    status: 'recorded',
    method: 'card',
    reference: 'pi_3AbcDefGhi123',
  };
  state.invoice = { id: INVOICE, clinic_id: CLINIC, patient_id: PATIENT, currency: 'jod' };
  state.paymentsForInvoice = [{ direction: 'payment', amount: 100, status: 'recorded' }];
  state.trackedRefund = null;
  state.claimed = true;
  state.updates = [];
  state.inserts = [];
  state.rpcCalls = [];
  state.rpcResult = { data: 'refund-row-1', error: null };
  providerFns.createRefund.mockReset();
  providerFns.getRefund.mockReset();
  providerFns.createRefund.mockResolvedValue({
    id: 're_AbcDef123',
    status: 'pending',
    amountMinor: 20000, // 20.000 JOD (3 decimals)
    currency: 'jod',
  });
  providerFns.getRefund.mockResolvedValue({
    id: 're_AbcDef123',
    status: 'succeeded',
    amountMinor: 20000,
    currency: 'jod',
  });
});

// ---------------------------------------------------------------------------
// Admin refund initiation API
// ---------------------------------------------------------------------------

describe('POST /api/clinic/payments/refund — admin initiation', () => {
  it('full refund succeeds (201) and stores a lifecycle row', async () => {
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 20, reason: 'سداد زائد' }),
      })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.providerRefundId).toBe('re_AbcDef123');
    expect(json.data.currency).toBe('jod');
    expect(state.inserts.filter((x) => x.table === 'clinic_payment_refunds')).toHaveLength(1);
    const row = state.inserts.find((x) => x.table === 'clinic_payment_refunds')!.payload;
    expect(row.provider_refund_id).toBe('re_AbcDef123');
    expect(row.clinic_payment_id).toBe(PAYMENT);
    expect(providerFns.createRefund).toHaveBeenCalledTimes(1);
    const call = providerFns.createRefund.mock.calls[0][0];
    expect(call.amountMinor).toBe(20000); // JOD → 3 decimals
    expect(call.currency).toBe('jod');
    expect(call.paymentIntentId).toBe('pi_3AbcDefGhi123');
    expect(call.metadata.kind).toBe('portal_refund');
  });

  it('partial refund is allowed below the refundable cap', async () => {
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 5, reason: 'جزئي' }),
      })
    );
    expect(res.status).toBe(201);
  });

  it('over-refund is rejected server-side before hitting the provider', async () => {
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 999, reason: 'أكثر من المسموح' }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('REFUND_EXCEEDS_PAID');
    expect(providerFns.createRefund).not.toHaveBeenCalled();
  });

  it('rejects refunds on non-portal (cash) payments', async () => {
    state.payment = { ...state.payment, method: 'cash', reference: null };
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 5, reason: 'x' }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PAYMENT_NOT_PROVIDER_ELIGIBLE');
  });

  it('cross-tenant payment → 404 with NO provider call', async () => {
    state.payment = null; // scoped query found nothing
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 5, reason: 'x' }),
      })
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('PAYMENT_NOT_FOUND');
    expect(providerFns.createRefund).not.toHaveBeenCalled();
  });

  it('provider rejection (already refunded) → 400, no lifecycle row', async () => {
    providerFns.createRefund.mockRejectedValue(new Error('Charge has already been refunded.'));
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 20, reason: 'x' }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PROVIDER_REFUND_REJECTED');
    expect(state.inserts.filter((x) => x.table === 'clinic_payment_refunds')).toHaveLength(0);
  });

  it('provider failure (network) → 503 fail-closed', async () => {
    providerFns.createRefund.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 20, reason: 'x' }),
      })
    );
    expect(res.status).toBe(503);
  });

  it('duplicate refund request with the same idempotency key → ORIGINAL refund returned, no second provider call', async () => {
    // First attempt already created a lifecycle row (successful at provider).
    state.trackedRefund = {
      id: 'r-prior',
      clinic_id: CLINIC,
      clinic_payment_id: PAYMENT,
      provider_refund_id: 're_AbcDef123',
      amount: 20,
      currency: 'jod',
      status: 'succeeded',
      invoice_id: INVOICE,
      patient_id: PATIENT,
    };
    const key = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 999, reason: 'replay', idempotency_key: key }),
      })
    );
    expect(res.status).toBe(201); // idempotent success
    const json = await res.json();
    expect(json.data.refundId).toBe('r-prior');
    expect(json.data.providerRefundId).toBe('re_AbcDef123');
    expect(providerFns.createRefund).not.toHaveBeenCalled();
    expect(state.inserts.filter((x) => x.table === 'clinic_payment_refunds')).toHaveLength(0);
  });

  it('idempotency key reused for a DIFFERENT payment → 409, no provider call', async () => {
    state.trackedRefund = {
      id: 'r-prior',
      clinic_id: CLINIC,
      clinic_payment_id: '99999999-9999-9999-9999-999999999999', // not PAYMENT
      provider_refund_id: 're_AbcDef123',
      amount: 20,
      currency: 'jod',
      status: 'succeeded',
      invoice_id: INVOICE,
      patient_id: PATIENT,
    };
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({
          payment_id: PAYMENT,
          amount: 20,
          reason: 'x',
          idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        }),
      })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(providerFns.createRefund).not.toHaveBeenCalled();
    expect(state.inserts.filter((x) => x.table === 'clinic_payment_refunds')).toHaveLength(0);
  });

  it('malformed idempotency key → 400 before any provider call', async () => {
    const res = await refundPOST(
      new Request(`http://local/api/clinic/payments/refund?clinic_id=${CLINIC}`, {
        method: 'POST',
        body: JSON.stringify({ payment_id: PAYMENT, amount: 20, reason: 'x', idempotency_key: 'not-a-uuid' }),
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(providerFns.createRefund).not.toHaveBeenCalled();
  });
});
// ---------------------------------------------------------------------------
// Webhook-side lifecycle + accounting booking
// ---------------------------------------------------------------------------

describe('webhook refund branches — booking & idempotency', () => {
  function buildEvent(type: string, overrides: any = {}) {
    const refund = {
      id: 're_AbcDef123',
      object: 'refund',
      status: 'succeeded',
      amount: 20000,
      currency: 'jod',
      metadata: { kind: 'portal_refund', clinic_id: CLINIC, patient_id: PATIENT, invoice_id: INVOICE },
      ...overrides,
    };
    const raw = JSON.stringify({ id: `evt_${Date.now()}`, type, data: { object: refund } });
    return { raw, signature: sign(raw) };
  }

  beforeEach(() => {
    state.trackedRefund = {
      id: 'r1',
      clinic_id: CLINIC,
      clinic_payment_id: PAYMENT,
      amount: 20,
      currency: 'jod',
      status: 'pending',
      booked_at: null,
    };
  });

  it('refund.updated succeeded → books via refund_payment RPC exactly once', async () => {
    const { raw, signature } = buildEvent('refund.updated');
    const res = await webhookPOST(
      new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } })
    );
    expect(res.status).toBe(200);
    const refundRpc = state.rpcCalls.filter((c) => c.name === 'refund_payment');
    expect(refundRpc).toHaveLength(1);
    expect(refundRpc[0].params.p_payment_id).toBe(PAYMENT);
    expect(refundRpc[0].params.p_amount).toBeCloseTo(20, 2);
    // booked_at claim written
    expect(state.updates.some((u) => u.table === 'clinic_payment_refunds' && u.payload.booked_at)).toBe(true);
  });

  it('duplicate webhook delivery → exactly ONE refund_payment call', async () => {
    const { raw, signature } = buildEvent('refund.updated');
    await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    expect(state.rpcCalls.filter((c) => c.name === 'refund_payment')).toHaveLength(1);
  });

  it('invalid signature → 400 and ZERO writes/RPC', async () => {
    const { raw } = buildEvent('refund.updated');
    const res = await webhookPOST(
      new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': 't=1,v1=bad' } })
    );
    expect(res.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('untracked provider refund id → ignored (no write, no RPC)', async () => {
    state.trackedRefund = null;
    const { raw, signature } = buildEvent('refund.updated');
    const res = await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('provider live cross-check mismatch → needs_review, no RPC', async () => {
    providerFns.getRefund.mockResolvedValue({ id: 're_AbcDef123', status: 'failed', amountMinor: 20000, currency: 'jod' });
    const { raw, signature } = buildEvent('refund.updated');
    const res = await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates.some((u) => u.payload.status === 'needs_review')).toBe(true);
  });

  it('refund_payment RPC refuses (e.g. INVOICE_VOIDED) → needs_review, no retry booking', async () => {
    state.rpcResult = { data: null, error: { message: 'INVOICE_VOIDED' } };
    const { raw, signature } = buildEvent('refund.updated');
    const res = await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    expect(res.status).toBe(200);
    expect(state.updates.some((u) => u.payload.status === 'needs_review')).toBe(true);
    const rpcCount = state.rpcCalls.filter((c) => c.name === 'refund_payment').length;
    expect(rpcCount).toBe(1);
    // the atomic claim update must have been issued before the RPC
    expect(state.updates.filter((u) => u.payload.booked_at)).toHaveLength(1);
    expect(state.trackedRefund?.booked_at).not.toBeNull();
    // second delivery: booked_at already claimed → duplicate, still NO double book
    const res2 = await webhookPOST(new Request('http://local/api/payments/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': signature } }));
    expect(res2.status).toBe(200);
    expect(state.rpcCalls.filter((c) => c.name === 'refund_payment')).toHaveLength(1);
  });
});
const INVOICE = '66666666-6666-6666-6666-666666666666';