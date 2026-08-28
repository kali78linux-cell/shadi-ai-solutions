import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyStripeSignature } from '@/lib/payments/stripe';

// Deterministic secret + a helper to build a valid Stripe-style signature.
const SECRET = 'whsec_test_00000000000000000000000000000000';

function sign(raw: string, timestamp: number): string {
  const signed = `${timestamp}.${raw}`;
  const sig = createHmac('sha256', SECRET).update(signed, 'utf8').digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function makePayload(raw: string) {
  return sign(raw, Math.floor(Date.now() / 1000));
}

const sampleEvent = JSON.stringify({
  id: 'evt_test_1',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', client_reference_id: 'clinic-demo', metadata: { plan_id: 'growth' }, customer: 'cus_1', subscription: 'sub_1' } },
});

describe('Stripe webhook signature verification', () => {
  it('accepts a valid signature', () => {
    const header = makePayload(sampleEvent);
    expect(verifyStripeSignature(sampleEvent, header, SECRET)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const header = makePayload(sampleEvent);
    expect(verifyStripeSignature(sampleEvent + 'x', header, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const header = makePayload(sampleEvent);
    expect(verifyStripeSignature(sampleEvent, header, 'whsec_wrong')).toBe(false);
  });

  it('rejects a stale timestamp (replay)', () => {
    const old = Math.floor(Date.now() / 1000) - 400;
    const header = sign(sampleEvent, old);
    expect(verifyStripeSignature(sampleEvent, header, SECRET)).toBe(false);
  });

  it('rejects a missing header/secret', () => {
    expect(verifyStripeSignature(sampleEvent, null, SECRET)).toBe(false);
    expect(verifyStripeSignature(sampleEvent, makePayload(sampleEvent), null)).toBe(false);
  });
});