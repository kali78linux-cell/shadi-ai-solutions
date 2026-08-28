import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPendingBookingContext,
  applyPendingBookingContext,
} from '@/lib/ai/bookingContextBridge';

const db = vi.hoisted(() => {
  const q: Record<string, any> = { from: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() };
  return { q };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: db.q }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/services/reminderEngine', () => ({ createAppointmentReminders: vi.fn(), cancelAppointmentReminders: vi.fn() }));
vi.mock('@/lib/services/scheduling', () => ({ checkSlotAvailability: vi.fn(() => ({ available: true })), suggestFreeSlots: vi.fn() }));

import { createBooking } from '@/lib/services/bookingService';

const clinicId = '11111111-1111-1111-1111-111111111111';
const conversationId = '22222222-2222-2222-2222-222222222222';
const SVC = '33333333-3333-3333-3333-333333333333';
const PROV = '44444444-4444-4444-4444-444444444444';
const SLOT = '2026-08-27T13:00:00.000Z';

describe('booking conversation linkage (createBooking)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.q.from.mockReturnValue(db.q);
    db.q.select.mockReturnValue(db.q);
    db.q.eq.mockReturnValue(db.q);
    db.q.is.mockReturnValue(db.q);
    db.q.insert.mockReturnValue(db.q);
    db.q.update.mockReturnValue(db.q);
    db.q.maybeSingle.mockResolvedValue({ data: { id: conversationId, metadata: { subject_analysis: { problem: 'ألم' } } }, error: null });
    db.q.single.mockResolvedValue({ data: { id: '99999999-9999-9999-9999-999999999999', scheduled_at: '2026-07-20T09:00:00.000Z', status: 'tentative' }, error: null });
  });

  it('stores chat booking linkage in same-clinic conversation metadata without requiring pending appointment columns', async () => {
    await createBooking({ clinicId, providerId: PROV, service: 'فحص أسنان', serviceId: SVC, conversationId, date: '2026-07-20', time: '09:00', patientId: '66666666-6666-6666-6666-666666666666' });

    expect(db.q.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        subject_analysis: { problem: 'ألم' },
        booking: expect.objectContaining({ appointment_id: '99999999-9999-9999-9999-999999999999', service_id: SVC, provider_id: PROV }),
      }),
    }));
    expect(db.q.eq).toHaveBeenCalledWith('clinic_id', clinicId);
  });

  it('rejects a conversation that does not belong to the booking clinic', async () => {
    db.q.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(createBooking({ clinicId, providerId: PROV, service: 'فحص', conversationId, date: '2026-07-20', time: '09:00', patientId: '66666666-6666-6666-6666-666666666666' })).rejects.toThrow('Conversation not found for this clinic');
  });
});

describe('STEP 7 — booking conversation ⇄ UI bridging (pure)', () => {
  it('returns null when there is no booking signal (no invented prefill)', () => {
    expect(buildPendingBookingContext({})).toBeNull();
    expect(buildPendingBookingContext(null)).toBeNull();
    expect(buildPendingBookingContext({ booking: {} })).toBeNull();
  });

  it('derives service/provider ids + missing fields from canonical metadata', () => {
    const ctx = buildPendingBookingContext({
      recommended_service_id: SVC,
      recommended_provider_id: PROV,
      booking: { service_id: SVC, provider_id: PROV },
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.recommended_service_id).toBe(SVC);
    expect(ctx!.recommended_provider_id).toBe(PROV);
    expect(ctx!.missing).toContain('slot');
    expect(ctx!.missing).toContain('patient_name');
    expect(ctx!.missing).not.toContain('service');
    expect(ctx!.missing).not.toContain('provider');
  });

  it('treats a real availability slot as canonical (never invented)', () => {
    const ctx = buildPendingBookingContext({ booking: { slot: SLOT, patient_name: 'أحمد' } });
    expect(ctx!.slot).toBe(SLOT);
    expect(ctx!.missing).not.toContain('patient_name');
    expect(ctx!.missing).toContain('provider');
  });

  it('applies canonical context into UI only where the user has not chosen', () => {
    const ctx = buildPendingBookingContext({
      recommended_service_id: SVC,
      recommended_provider_id: PROV,
      booking: { slot: SLOT, patient_name: 'أحمد' },
    })!;
    const applied = applyPendingBookingContext(
      { selectedService: null, selectedProvider: null, selectedDate: null, selectedSlot: null, showBookingSummary: false, patientName: '', patientPhone: '', patientEmail: '', bookingMode: false },
      ctx
    );
    expect(applied.selectedService).toBe(SVC);
    expect(applied.selectedProvider).toBe(PROV);
    expect(applied.selectedSlot).toBe(SLOT);
    expect(applied.selectedDate).toBe('2026-08-27');
    expect(applied.showBookingSummary).toBe(true);
    expect(applied.patientName).toBe('أحمد');
  });

  it('never overwrites a user selection already chosen in the UI', () => {
    const ctx = buildPendingBookingContext({
      booking_service_id: SVC,
      booking: { provider_id: PROV, slot: SLOT, patient_name: 'سارة' },
    })!;
    const applied = applyPendingBookingContext(
      { selectedService: 'user-service', selectedProvider: 'user-provider', selectedDate: '2026-08-28', selectedSlot: '2026-08-28T10:00:00.000Z', showBookingSummary: true, patientName: 'المستخدم', patientPhone: '0599', patientEmail: '', bookingMode: true },
      ctx
    );
    expect(applied.selectedService).toBe('user-service');
    expect(applied.selectedProvider).toBe('user-provider');
    expect(applied.selectedSlot).toBe('2026-08-28T10:00:00.000Z');
    expect(applied.selectedDate).toBe('2026-08-28');
    expect(applied.patientName).toBe('المستخدم');
    expect(applied.patientPhone).toBe('0599');
  });

  it('preserves patient_confirmed_booking and empty email is not treated as missing', () => {
    const ctx = buildPendingBookingContext({ patient_confirmed_booking: true, booking: { slot: SLOT, patient_name: 'أحمد', phone: '0591234567', email: '' } });
    expect(ctx).not.toBeNull();
    expect(ctx!.patient_confirmed_booking).toBe(true);
    expect(ctx!.missing).not.toContain('patient_name');
  });
});
