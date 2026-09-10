import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Direct coverage for the Stripe REST form builder (no SDK — REST over fetch).
 * Guards the DUPLICATE-PREVENTION contract: the clinic/plan identity must be
 * mirrored onto the created SUBSCRIPTION itself (subscription_data.metadata),
 * so every Stripe subscription is provably attributable to a clinic.
 */
import { createCheckoutSession } from '@/lib/payments/stripe';

const fetchMock = vi.fn();

describe('Stripe checkout form — subscription_data metadata mapping', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_form';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/x', id: 'cs_test_form' }), { status: 200 })
    );
  });

  it('mirrors clinic/plan metadata onto the created subscription (documented subscription_data param)', async () => {
    await createCheckoutSession({
      priceId: 'price_growthtest123',
      successUrl: 'https://app.example/success',
      cancelUrl: 'https://app.example/cancel',
      clientReferenceId: 'clinic-uuid-1',
      metadata: { plan_id: 'growth', clinic_id: 'clinic-uuid-1' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_form');

    const body = decodeURIComponent(String(init.body));
    // Session-level identity (existing contract).
    expect(body).toContain('client_reference_id=clinic-uuid-1');
    expect(body).toContain('metadata[plan_id]=growth');
    expect(body).toContain('metadata[clinic_id]=clinic-uuid-1');
    // Subscription-level identity (duplicate-prevention contract).
    expect(body).toContain('subscription_data[metadata][plan_id]=growth');
    expect(body).toContain('subscription_data[metadata][clinic_id]=clinic-uuid-1');
  });

  it('still builds a valid subscription checkout when metadata is omitted', async () => {
    await createCheckoutSession({
      priceId: 'price_x',
      successUrl: 'https://app.example/success',
      cancelUrl: 'https://app.example/cancel',
      clientReferenceId: 'clinic-uuid-2',
    });
    const body = decodeURIComponent(String(fetchMock.mock.calls[0][1].body));
    expect(body).toContain('mode=subscription');
    expect(body).toContain('line_items[0][price]=price_x');
    expect(body).toContain('line_items[0][quantity]=1');
    expect(body).not.toContain('subscription_data[metadata]');
  });
});
