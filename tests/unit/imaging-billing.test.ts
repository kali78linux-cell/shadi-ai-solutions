import { describe, it, expect, vi, beforeEach } from 'vitest';
import { issueInvoiceForImagingRequest } from '@/lib/services/imagingBilling';

/**
 * IMAGING → BILLING contract (Section 5/18/19):
 * - completed + billable service → invoice issued once (idempotent).
 * - no service / no patient / no price / hidden price → no invoice.
 * - marker-based idempotency prevents double billing.
 */
const state = vi.hoisted(() => ({
  request: null as Record<string, unknown> | null,
  service: null as Record<string, unknown> | null,
  invoices: [] as Array<Record<string, unknown>>,
  updated: [] as string[],
  rpcCalls: 0,
  invoiceCounter: 0,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.ilike = () => chain;
      chain.is = () => chain;
      chain.in = () => chain;
      chain.update = (patch: any) => {
        if (table === 'imaging_requests' && patch.imaging_status) state.updated.push(String(patch.imaging_status));
        return { eq: () => chain };
      };
      chain.maybeSingle = () => {
        if (table === 'imaging_requests') return Promise.resolve({ data: state.request, error: null });
        if (table === 'clinic_services') return Promise.resolve({ data: state.service, error: null });
        if (table === 'clinic_invoices') return Promise.resolve({ data: state.invoices[0] ?? null, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      chain.insert = () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) });
      return chain;
    }),
    rpc: vi.fn(() => {
      state.rpcCalls += 1;
      state.invoiceCounter += 1;
      return Promise.resolve({ data: { invoice_id: 'inv-' + state.invoiceCounter, invoice_number: 'INV-' + String(1000 + state.invoiceCounter) }, error: null });
    }),
  },
}));
vi.mock('@/lib/services/accounting', () => ({
  issueInvoice: vi.fn(async () => {
    state.rpcCalls += 1;
    state.invoiceCounter += 1;
    return { invoiceId: 'inv-' + state.invoiceCounter, invoiceNumber: 'INV-' + String(1000 + state.invoiceCounter) };
  }),
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { issueInvoice } from '@/lib/services/accounting';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const REQUEST = '22222222-2222-2222-2222-222222222222';
const PATIENT = '33333333-3333-3333-3333-333333333333';
const SERVICE = '44444444-4444-4444-4444-444444444444';

function billableRequest() {
  return { id: REQUEST, clinic_id: CLINIC, patient_id: PATIENT, service_id: SERVICE, requested_service: 'تصوير بانوراما', referring_provider_id: null, appointment_id: null, status: 'completed', deleted_at: null };
}
function pricedService() {
  return { id: SERVICE, name: 'تصوير بانوراما', pricing_type: 'fixed', price: 30, price_min: null, price_max: null, price_visible_to_patients: true, active: true };
}

describe('imagingBilling.issueInvoiceForImagingRequest', () => {
  beforeEach(() => {
    state.request = billableRequest();
    state.service = pricedService();
    state.invoices = [];
    state.updated = [];
    state.rpcCalls = 0;
    state.invoiceCounter = 0;
    vi.clearAllMocks();
  });

  it('completed + billable service → issues invoice exactly once and marks performed', async () => {
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(true);
    expect(state.updated).toContain('performed');
    expect(issueInvoice).toHaveBeenCalledTimes(1);
  });

  it('idempotent: existing invoice with the marker → skip (no double billing)', async () => {
    state.invoices = [{ id: 'inv-existing', invoice_number: 'INV-1000' }];
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(res.reason).toBe('already_issued');
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('no service_id → nothing billable (no invoice)', async () => {
    state.request = { ...billableRequest(), service_id: null };
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(res.reason).toBe('nothing_billable');
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('no patient → nothing billable', async () => {
    state.request = { ...billableRequest(), patient_id: null };
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('service without a resolvable price → no invoice (never invented)', async () => {
    state.service = { ...pricedService(), price: null, price_min: null, price_max: null };
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(res.reason).toBe('no_price');
    expect(issueInvoice).not.toHaveBeenCalled();
  });

  it('hidden price → no invoice', async () => {
    state.service = { ...pricedService(), price_visible_to_patients: false };
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(res.reason).toBe('price_hidden');
  });

  it('cross-tenant request → request_not_found (no billing)', async () => {
    state.request = { ...billableRequest(), clinic_id: '99999999-9999-9999-9999-999999999999' };
    const res = await issueInvoiceForImagingRequest({ clinicId: CLINIC, requestId: REQUEST, actorUserId: null });
    expect(res.issued).toBe(false);
    expect(res.reason).toBe('request_not_found');
  });
});