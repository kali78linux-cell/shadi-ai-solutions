import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrCreatePatient: vi.fn(),
  createBooking: vi.fn(),
  supabaseAdmin: { from: vi.fn() },
}));

// Preserve the real isValidBookingPhone (and any other real export) while
// stubbing only the two booking-execution functions.
vi.mock('@/lib/services/bookingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bookingService')>()),
  findOrCreatePatient: mocks.findOrCreatePatient,
  createBooking: mocks.createBooking,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { attemptConversationBooking, missingBookingFields, parseSlot } from '@/lib/ai/conversationBooking';

const clinicId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';

/**
 * Chainable Supabase query builder mock. The production idempotency guard
 * chains `.from().select().eq().eq().maybeSingle()` — every builder method
 * returns the same chainable object so ANY number of `.eq()` calls resolves
 * to the terminal result (regression-fix: previous mock supported one `.eq()`
 * only, which made the guard throw and the "already booked" path unreachable).
 */
function metadataQuery(result: { data: any; error: any }) {
  const q: Record<string, any> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn(() => q);
  q.is = vi.fn(() => q);
  q.single = vi.fn(async () => result);
  q.maybeSingle = vi.fn(async () => result);
  return q;
}

const baseData: any = {
  services: [{ id: 's1', name: 'زراعة أسنان', duration_minutes: 60 }],
  providers: [{ id: 'p1', name: 'د. أحمد' }],
  providerServiceIds: [{ provider_id: 'p1', service_id: 's1' }],
  hasServices: true,
  hasProviders: true,
  usable: true,
};

const fullBooking = {
  service_id: 's1',
  provider_id: 'p1',
  slot: '2026-09-01T10:00:00.000Z',
  patient_name: 'محمد أحمد',
  phone: '0599999999',
  email: null,
};

function metaResult(data: any) {
  return { data, error: null };
}

async function runAttempt(booking: any, override: any = {}) {
  return attemptConversationBooking({
    clinicId,
    conversationId,
    state: 'BOOKING',
    patientConfirmedBooking: true,
    booking,
    operatingData: baseData,
    ...override,
  });
}

describe('conversationBooking', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists all missing booking fields for an empty booking', () => {
    const missing = missingBookingFields({
      booking: { service_id: null, provider_id: null, slot: null, patient_name: '', phone: '' },
    });
    for (const f of ['service', 'provider', 'patient_name', 'phone', 'slot']) expect(missing).toContain(f);
  });

  it('is not ready unless state=BOOKING AND patient confirmed', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: {} })));
    const r = await runAttempt(fullBooking, { state: 'RECOMMENDING_PROVIDER', patientConfirmedBooking: false });
    expect(r.action).toBe('not_ready');
  });

  it('never books twice: already-booked metadata is honored (idempotency)', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: { booking: { appointment_id: 'appt-1' } } })));
    const r = await runAttempt(fullBooking);
    expect(r.action).toBe('already_booked');
    expect((r as any).appointment_id).toBe('appt-1');
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it('asks only for what is still missing (name/phone not yet collected)', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: null })));
    const r = await runAttempt({ ...fullBooking, patient_name: null, phone: null });
    expect(r.action).toBe('need_more_info');
    expect((r as any).missing).toEqual(['patient_name', 'phone']);
  });

  it('completes a booking inside the conversation and returns the appointment', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: null })));
    mocks.findOrCreatePatient.mockResolvedValue('patient-1');
    mocks.createBooking.mockResolvedValue({ id: 'appt-9', scheduled_at: '2026-09-01T10:00:00.000Z', status: 'tentative' });
    const r = await runAttempt(fullBooking);
    expect(r.action).toBe('booked');
    expect(mocks.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      clinicId, providerId: 'p1', service: 'زراعة أسنان', serviceId: 's1', conversationId,
    }));
  });

  it('maps a concurrent booking race to slot_unavailable (safe failure, one winner)', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: null })));
    mocks.findOrCreatePatient.mockResolvedValue('patient-1');
    mocks.createBooking.mockRejectedValue(new Error('Slot unavailable: concurrent booking'));
    const r = await runAttempt(fullBooking);
    expect(r.action).toBe('slot_unavailable');
    expect(mocks.createBooking).toHaveBeenCalledTimes(1);
  });

  it('rejects a recommendation whose service belongs to another clinic', async () => {
    mocks.supabaseAdmin.from.mockReturnValue(metadataQuery(metaResult({ metadata: null })));
    const r = await runAttempt({ ...fullBooking, service_id: 'service-OTHER' });
    expect(r.action).toBe('failed');
    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it('parses a slot into date + time', () => {
    expect(parseSlot('2026-09-01T10:00:00.000Z')).toEqual(['2026-09-01', '10:00']);
  });
});