import { describe, expect, it } from 'vitest';
import { missingBookingFields } from '@/lib/ai/conversationBooking';

/**
 * PHASE A — provider-optionality contract: `provider` is ONLY a required
 * booking field when the selected service is marked requires_provider=true
 * (imaging centers must not be forced into dentist/provider selection).
 */
describe('missingBookingFields — provider optionality (PHASE A)', () => {
  const base = {
    booking: {
      service_id: 'svc-1',
      provider_id: null,
      slot: '2026-09-08T09:00:00.000Z',
      patient_name: 'مريض',
      phone: '0599123456',
    },
  };

  it('does NOT require provider when service requires_provider=false', () => {
    const missing = missingBookingFields(base, false);
    expect(missing).not.toContain('provider');
    expect(missing).toEqual([]);
  });

  it('DOES require provider when service requires_provider=true', () => {
    const missing = missingBookingFields(base, true);
    expect(missing).toContain('provider');
  });

  it('accepts a provided provider regardless of the flag', () => {
    const withProvider = { booking: { ...base.booking, provider_id: 'prov-1' } };
    expect(missingBookingFields(withProvider, false)).not.toContain('provider');
    expect(missingBookingFields(withProvider, true)).not.toContain('provider');
  });
});
