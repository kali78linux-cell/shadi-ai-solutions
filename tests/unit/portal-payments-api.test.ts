import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

/**
 * PP-3 — API + webhook integration behavior (mocked provider/supabase).
 * Live DB behavior is verified separately via the self-rollback probe.
 */

const state = vi.hoisted(() => ({
  invoice: null as any,
  balance: null as any,
  connect: null as any, // lookup by clinic_id
  connectByAcct: null as any, // lookup by stripe_account_id
  intent: null as any, // lookup by stripe_payment_intent_id
  updates: [] as Array<{ table: string; payload: any }>,
  inserts: [] as Array<{ table: string; payload: any }>,
  rpcCalls: [] as Array<{ name: string; params: any }>,
  rpcResult: { data: { payment_id: 'pay_1', duplicate: false }, error: null } as any,
}));

const providerFns = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
  getPaymentIntent: vi.fn(),
  createConnectAccount: vi.fn(),
  createConnectAccountLink: vi.fn(),
  getConnectAccountReadiness: vi.fn(),
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
        maybeSingle: () => ({
          then: (res: (x: unknown) => void) => {
            let row: any = null;
            if (table === 'clinic_invoices') row = state.invoice;
            else if (table === 'invoice_balances') row = state.balance;
            else if (table === 'clinic_payment_intents') row = state.intent;
            else if (table === 'clinic_stripe_connect_accounts')
              row = 'stripe_account_id' in filters ? state.connectByAcct : state.connect;
            res({ data: row, error: null });
          },
        }),
        single: () => ({ then: (res: (x: unknown) => void) => res({ data: null, error: null }) }),
        update: (payload: any) => {
          state.updates.push({ table, payload });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        insert: (payload: any) => {
          state.inserts.push({ table, payload });
          return Promise.resolve({ data: null, error: null });
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
  countryToCode: vi.fn((c: string | null) => (c === 'فلسطين' ? 'PS' : null)),
}));

const IDENTITY = {
  id: 'i1',
  clinic_id: '11111111-1111-1111-1111-111111111111',
  patient_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'p@x.com',
};

vi.mock('@/lib/services/patientPortal', () => ({
  authorizePatientRequest: vi.fn(async () => ({ identity: IDENTITY })),
}));
// Connect onboarding route is clinic-admin gated — mock the membership gate.
vi.mock('@/lib/services/clinicAuthorization', () => ({
  authorizeClinicRequest: vi.fn(async () => ({ authorized: true, user: { id: 'u1' }, role: 'owner' })),
  roleDenied: vi.fn((auth: { role?: string }, roles: readonly string[]) =>
    roles.includes(auth.role ?? '') ? null : { authorized: false as const, status: 403 as const }
  ),
  FINANCE_ADMIN_ROLES: ['owner', 'accountant'],
}));

import { POST as intentPOST } from '@/app/api/portal/payments/intent/route';
import { POST as connectPOST } from '@/app/api/clinic/payments/connect/route';
import { POST as webhookPOST } from '@/app/api/payments/webhook/route';
import { authorizePatientRequest } from '@/lib/services/patientPortal';
import { countryToCode } from '@/lib/clinic/localization';

const SECRET = 'whsec_test_00000000000000000000000000000000';
function sign(raw: string, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${createHmac('sha256', SECRET).update(`${ts}.${raw}`, 'utf8').digest('hex')}`;
}
function webhookRequest(event: any) {
  const raw = JSON.stringify(event);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'stripe-signature': sign(raw) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_pp3';
  state.invoice = null;
  state.balance = null;
  state.connect = null;
  state.connectByAcct = null;
  state.intent = null;
  state.updates = [];
  state.inserts = [];
  state.rpcCalls = [];
  state.rpcResult = { data: { payment_id: 'pay_1', duplicate: false }, error: null };
  (authorizePatientRequest as any).mockResolvedValue({ identity: IDENTITY });
});

describe('POST /api/portal/payments/intent — auth gating', () => {
  it('401 unauthenticated / 403 revoked identity', async () => {
    (authorizePatientRequest as any).mockResolvedValueOnce({
      error: { code: 'PATIENT_UNAUTHENTICATED', status: 401 },
    });
    let res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: '11111111-1111-1111-1111-111111111111' }) }));
    expect(res.status).toBe(401);
    (authorizePatientRequest as any).mockResolvedValueOnce({
      error: { code: 'NO_ACTIVE_PATIENT_IDENTITY', status: 403 },
    });
    res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: '11111111-1111-1111-1111-111111111111' }) }));
    expect(res.status).toBe(403);
    expect(state.inserts).toHaveLength(0);
  });

  it('400 invalid body (uuid-invalid invoice_id)', async () => {
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: 'not-a-uuid' }) }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Ownership / payable / readiness gating
// ---------------------------------------------------------------------------

const INV = '22222222-2222-2222-2222-222222222222';
function payableFixtures(currency: string | null) {
  state.invoice = {
    id: INV, clinic_id: IDENTITY.clinic_id, patient_id: IDENTITY.patient_id,
    status: 'issued', currency, total: 70.5,
  };
  state.balance = { balance_amount: 70.5 };
  state.connect = {
    id: 'c1', stripe_account_id: 'acct_pp3', charges_enabled: true,
    payouts_enabled: true, onboarding_status: 'complete', country: 'PS',
  };
  providerFns.getConnectAccountReadiness.mockResolvedValue({
    chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
  });
}

describe('POST intent — ownership & payable gating', () => {
  it('404 for a non-owned invoice (no existence disclosure)', async () => {
    state.invoice = null; // composite-scoped query returns nothing for non-owned
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('INVOICE_NOT_FOUND');
  });

  it('409 INVOICE_VOIDED', async () => {
    payableFixtures('JOD');
    state.invoice.status = 'voided';
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect((await res.json()).error).toBe('INVOICE_VOIDED');
  });

  it('409 INVOICE_NOT_PAYABLE when balance <= 0', async () => {
    payableFixtures('JOD');
    state.balance = { balance_amount: 0 };
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect((await res.json()).error).toBe('INVOICE_NOT_PAYABLE');
  });

  it('409 PROVIDER_NOT_CONNECTED when the clinic has no connect account', async () => {
    payableFixtures('JOD');
    state.connect = null;
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect((await res.json()).error).toBe('PROVIDER_NOT_CONNECTED');
  });

  it('409 PROVIDER_NOT_READY when charges are not enabled', async () => {
    payableFixtures('JOD');
    providerFns.getConnectAccountReadiness.mockResolvedValue({
      chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true,
    });
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect((await res.json()).error).toBe('PROVIDER_NOT_READY');
  });
});

// ---------------------------------------------------------------------------
// Create / reuse / currency authority
// ---------------------------------------------------------------------------

describe('POST intent — create / reuse / currency authority', () => {
  it('creates with SERVER-DERIVED amount + invoice-authoritative currency (JOD → 3 decimals)', async () => {
    payableFixtures('JOD');
    providerFns.createPaymentIntent.mockResolvedValue({
      id: 'pi_new', status: 'requires_payment_method', amountMinor: 70500,
      currency: 'jod', clientSecret: 'pi_new_secret', failureMessage: null,
    });
    const res = await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Exactly the approved exposure surface — nothing else:
    expect(Object.keys(body).sort()).toEqual(['amount', 'client_secret', 'currency', 'payment_intent_id', 'status']);
    expect(body.currency).toBe('jod'); // invoice snapshot wins over settings ('ils')
    expect(body.amount).toBe(70.5);
    // JOD: 70.5 * 1000 = 70500 fils (3-decimal currency handled)
    expect(providerFns.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 70500, currency: 'jod' })
    );
    // Connect destination = the clinic's own account (never client-controlled)
    expect(providerFns.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ destinationAccountId: 'acct_pp3', onBehalfOfAccountId: 'acct_pp3' })
    );
    // metadata carries the routing identity
    expect(providerFns.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          clinic_id: IDENTITY.clinic_id,
          patient_id: IDENTITY.patient_id,
          invoice_id: INV,
          kind: 'portal_payment',
        },
      })
    );
    expect(state.inserts.some((i) => i.table === 'clinic_payment_intents')).toBe(true);
  });

  it('falls back to clinic_settings currency ONLY for legacy NULL-currency invoices', async () => {
    payableFixtures(null);
    providerFns.createPaymentIntent.mockResolvedValue({
      id: 'pi_new2', status: 'requires_payment_method', amountMinor: 7050,
      currency: 'ils', clientSecret: 's', failureMessage: null,
    });
    await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }));
    expect(providerFns.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'ils', amountMinor: 7050 })
    );
  });

  it('REUSES a compatible active intent (no create call), live client_secret returned', async () => {
    payableFixtures('JOD');
    state.intent = {
      id: 'row1', stripe_payment_intent_id: 'pi_existing', amount: 70.5, currency: 'jod', status: 'requires_payment_method',
    };
    providerFns.getPaymentIntent.mockResolvedValue({
      id: 'pi_existing', status: 'requires_payment_method', amountMinor: 70500,
      currency: 'jod', clientSecret: 'pi_existing_secret', failureMessage: null,
    });
    const body = await (await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }))).json();
    expect(body.payment_intent_id).toBe('pi_existing');
    expect(body.client_secret).toBe('pi_existing_secret');
    expect(providerFns.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('retires a STALE intent (balance changed) and creates a fresh one', async () => {
    payableFixtures('JOD');
    state.intent = {
      id: 'row1', stripe_payment_intent_id: 'pi_stale', amount: 100, currency: 'jod', status: 'requires_payment_method',
    };
    providerFns.getPaymentIntent.mockResolvedValue({
      id: 'pi_stale', status: 'requires_payment_method', amountMinor: 100000,
      currency: 'jod', clientSecret: 'stale', failureMessage: null,
    });
    providerFns.createPaymentIntent.mockResolvedValue({
      id: 'pi_fresh', status: 'requires_payment_method', amountMinor: 70500,
      currency: 'jod', clientSecret: 'fresh', failureMessage: null,
    });
    const body = await (await intentPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ invoice_id: INV }) }))).json();
    expect(body.payment_intent_id).toBe('pi_fresh');
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'canceled')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/clinic/payments/connect — onboarding (FINANCE_ADMIN, server URLs)
// ---------------------------------------------------------------------------

describe('POST /api/clinic/payments/connect — onboarding', () => {
  it('400 when the clinic profile has no usable country (no assumptions)', async () => {
    const res = await connectPOST(new Request('http://x/api/clinic/payments/connect?clinic_id=c1', { method: 'POST' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('PROVIDER_COUNTRY_REQUIRED');
    expect(providerFns.createConnectAccount).not.toHaveBeenCalled();
  });

  it('creates account + hosted onboarding link (server-built same-origin URLs)', async () => {
    (countryToCode as any).mockReturnValue('PS');
    providerFns.createConnectAccount.mockResolvedValue({ accountId: 'acct_new' });
    providerFns.createConnectAccountLink.mockResolvedValue({ url: 'https://connect.stripe.com/onboard' });
    const res = await connectPOST(new Request('http://x/api/clinic/payments/connect?clinic_id=c1', { method: 'POST' }));
    const body = await res.json();
    expect(body.accountId).toBe('acct_new');
    expect(body.onboarding_url).toBe('https://connect.stripe.com/onboard');
    expect(state.inserts.some((i) => i.table === 'clinic_stripe_connect_accounts')).toBe(true);
    expect(providerFns.createConnectAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshUrl: 'http://x/dashboard/settings/payments?connect=refresh',
        returnUrl: 'http://x/dashboard/settings/payments?connect=return',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Webhook branches (D-PP3-b)
// ---------------------------------------------------------------------------

function portalIntentEvent(overrides: Record<string, unknown> = {}) {
  return webhookRequest({
    id: 'evt_pp3_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_tracked',
        amount: 70500,
        currency: 'jod',
        status: 'succeeded',
        metadata: {
          clinic_id: IDENTITY.clinic_id,
          patient_id: IDENTITY.patient_id,
          invoice_id: '33333333-3333-3333-3333-333333333333',
          kind: 'portal_payment',
        },
        ...overrides,
      },
    },
  });
}

describe('Webhook — payment_intent.succeeded (the ONLY ledger-writing path)', () => {
  beforeEach(() => {
    state.intent = {
      id: 'row1', clinic_id: IDENTITY.clinic_id, patient_id: IDENTITY.patient_id,
      invoice_id: '33333333-3333-3333-3333-333333333333', amount: 70.5, currency: 'jod', status: 'requires_payment_method',
    };
    providerFns.getPaymentIntent.mockResolvedValue({
      id: 'pi_tracked', status: 'succeeded', amountMinor: 70500, currency: 'jod',
      clientSecret: null, failureMessage: null,
    });
  });

  it('invalid signature → 400 and ZERO writes', async () => {
    const raw = JSON.stringify({ id: 'evt_x', type: 'payment_intent.succeeded', data: { object: { id: 'pi_tracked' } } });
    const res = await webhookPOST(new Request('http://localhost/api/payments/webhook', {
      method: 'POST', body: raw, headers: { 'stripe-signature': 't=1,v1=bad' },
    }));
    expect(res.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('records via the existing record_payment RPC (card, reference=pi, deterministic uuid key)', async () => {
    const res = await webhookPOST(portalIntentEvent());
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(1);
    const call = state.rpcCalls[0];
    expect(call.name).toBe('record_payment');
    expect(call.params.p_method).toBe('card');
    expect(call.params.p_reference).toBe('pi_tracked');
    expect(call.params.p_idempotency_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(call.params.p_amount).toBeCloseTo(70.5, 6); // minor → major (3-decimal JOD)
    expect(call.params.p_recorded_by).toBeNull();
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'succeeded')).toBe(true);
  });

  it('duplicate webhook → same deterministic idempotency key (DB guarantees 1 row)', async () => {
    await webhookPOST(portalIntentEvent());
    await webhookPOST(portalIntentEvent());
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls[0].params.p_idempotency_key).toEqual(state.rpcCalls[1].params.p_idempotency_key);
  });

  it('invoice voided before webhook → requires_review, fail-closed (no books write)', async () => {
    state.rpcResult = { data: null, error: { message: 'INVOICE_VOIDED' } };
    const res = await webhookPOST(portalIntentEvent());
    expect(res.status).toBe(200); // ack'd; reconciled as requires_review
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'requires_review')).toBe(true);
  });

  it('metadata mismatch → requires_review and NO rpc call', async () => {
    await webhookPOST(portalIntentEvent({
      metadata: { clinic_id: '99999999-9999-9999-9999-999999999999', kind: 'portal_payment' },
    }));
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'requires_review')).toBe(true);
  });

  it('amount/currency mismatch vs provider → requires_review and NO rpc call', async () => {
    providerFns.getPaymentIntent.mockResolvedValue({
      id: 'pi_tracked', status: 'succeeded', amountMinor: 999999, currency: 'usd',
      clientSecret: null, failureMessage: null,
    });
    await webhookPOST(portalIntentEvent());
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'requires_review')).toBe(true);
  });

  it('non-portal intents (kind missing) are ignored — Platform Billing isolated', async () => {
    await webhookPOST(portalIntentEvent({ metadata: {} }));
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});

describe('Webhook — failed / dispute / account.updated (lifecycle only, zero ledger)', () => {
  it('payment_intent.payment_failed → status=failed, no rpc', async () => {
    state.intent = { id: 'row1', clinic_id: IDENTITY.clinic_id };
    const res = await webhookPOST(webhookRequest({
      id: 'evt_f1', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_tracked', metadata: { kind: 'portal_payment' }, last_payment_error: { message: 'card declined' } } },
    }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates.some((u) => u.table === 'clinic_payment_intents' && u.payload.status === 'failed')).toBe(true);
  });

  it('charge.dispute.created → audit only, no auto-refund (no rpc)', async () => {
    state.intent = { id: 'row1', clinic_id: IDENTITY.clinic_id };
    const res = await webhookPOST(webhookRequest({
      id: 'evt_d1', type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', payment_intent: 'pi_tracked', reason: 'fraudulent' } },
    }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('account.updated → readiness mirror updated, no rpc (amendment #4)', async () => {
    state.connectByAcct = { id: 'c1', clinic_id: IDENTITY.clinic_id, onboarding_status: 'pending' };
    const res = await webhookPOST(webhookRequest({
      id: 'evt_a1', type: 'account.updated',
      data: { object: { id: 'acct_pp3', charges_enabled: true, payouts_enabled: true, details_submitted: true } },
    }));
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates.some((u) => u.table === 'clinic_stripe_connect_accounts' && u.payload.onboarding_status === 'complete')).toBe(true);
  });

  it('Platform Billing isolation: non-portal lifecycle events never touch portal paths', async () => {
    await webhookPOST(webhookRequest({
      id: 'evt_f2', type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_platform', metadata: { kind: 'platform_billing' } } },
    }));
    expect(state.rpcCalls).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });
});