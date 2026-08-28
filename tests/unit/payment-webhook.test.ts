import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { POST } from '@/app/api/payments/webhook/route';

const SECRET = 'whsec_test_00000000000000000000000000000000';

// Minimal but honest mock: `from()` returns a self-returning thenable chain so the
// real handler's `.select().eq().is().maybeSingle()`/`update`/`insert` calls resolve.
const mockState = vi.hoisted(() => ({ existing: null }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {};
      const resolved = () => ({ data: mockState.existing, error: null });
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) chain[m] = () => chain;
      chain.single = () => resolved();
      chain.maybeSingle = () => resolved();
      chain.then = (res: (x: unknown) => void) => res(resolved());
      chain.update = () => ({ eq: () => chain.select() as any });
      chain.insert = () => ({ select: () => ({ single: () => resolved() }) });
      return chain;
    }),
  },
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

function sign(raw: string, ts = Math.floor(Date.now() / 1000)) {
  return `t=${ts},v1=${createHmac('sha256', SECRET).update(`${ts}.${raw}`, 'utf8').digest('hex')}`;
}
function buildEvent() {
  return JSON.stringify({
    id: 'evt_test_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', client_reference_id: 'clinic-demo', metadata: { plan_id: 'growth' }, customer: 'cus_1', subscription: 'sub_1' } },
  });
}

describe('Stripe webhook endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    mockState.existing = null;
  });

  it('returns 200 for a valid checkout.session.completed event', async () => {
    const raw = buildEvent();
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': sign(raw) },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it('returns 400 for an invalid signature', async () => {
    const raw = buildEvent();
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1234567890,v1=deadbeef' },
      body: raw,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a missing signature header', async () => {
    const raw = buildEvent();
    const req = new Request('http://localhost/api/payments/webhook', { method: 'POST', body: raw });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});