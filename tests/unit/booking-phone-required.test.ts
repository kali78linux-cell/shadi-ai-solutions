import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isValidBookingPhone } from '@/lib/services/bookingService';

// Conversation path mock (findOrCreatePatient / createBooking must be stubbed
// so we can assert they are NOT reached when phone is invalid).
const svc = vi.hoisted(() => ({
  findOrCreatePatient: vi.fn(async () => '66666666-6666-6666-6666-666666666666'),
  createBooking: vi.fn(async () => ({ id: '99999999-9999-9999-9999-999999999999', scheduled_at: '2026-01-01T09:00:00.000Z', status: 'tentative', booking_token: 'tok' })),
}));
vi.mock('@/lib/services/bookingService', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, findOrCreatePatient: svc.findOrCreatePatient, createBooking: svc.createBooking };
});
vi.mock('@/lib/supabase/admin', () => {
  const q: Record<string, any> = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), insert: vi.fn() };
  return { supabaseAdmin: q };
});
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { attemptConversationBooking } from '@/lib/ai/conversationBooking';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const CONV = '22222222-2222-2222-2222-222222222222';
const SVC = '33333333-3333-3333-3333-333333333333';
const PROV = '44444444-4444-4444-4444-444444444444';
const SLOT = '2026-08-27T13:00:00.000Z';
const email = null;

function bookedBooking(phone: unknown) {
  return { service_id: SVC, provider_id: PROV, slot: SLOT, patient_name: 'أحمد', phone: (phone as string) ?? null, email };
}
const operatingData = {
  services: [{ id: SVC, name: 'فحص أسنان', duration_minutes: 30 }],
  providers: [{ id: PROV, name: 'سارة' }],
} as any;

/** Type-narrowed access to `missing` for `need_more_info` results. */
function missingOf(res: Awaited<ReturnType<typeof attemptConversationBooking>>): string[] {
  return res.action === 'need_more_info' ? (res.missing as string[]) : [];
}

describe('isValidBookingPhone (server-side phone requirement)', () => {
  it('accepts a valid phone', () => {
    expect(isValidBookingPhone('0599123456')).toBe(true);
    expect(isValidBookingPhone('+972599123456')).toBe(true);
    expect(isValidBookingPhone('0599 123 456')).toBe(true);
  });
  it('rejects missing phone', () => {
    expect(isValidBookingPhone(undefined)).toBe(false);
  });
  it('rejects null phone', () => {
    expect(isValidBookingPhone(null)).toBe(false);
  });
  it('rejects empty string phone', () => {
    expect(isValidBookingPhone('')).toBe(false);
  });
  it('rejects whitespace-only phone', () => {
    expect(isValidBookingPhone('   ')).toBe(false);
  });
  it('rejects invalid phone (letters / too short)', () => {
    expect(isValidBookingPhone('abc')).toBe(false);
    expect(isValidBookingPhone('123')).toBe(false);
    expect(isValidBookingPhone('call me')).toBe(false);
  });
});

describe('conversation booking path — phone is a hard requirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('valid phone + real slot + confirmed → proceeds to guarded booking flow', async () => {
    const res = await attemptConversationBooking({
      clinicId: CLINIC, conversationId: CONV, state: 'BOOKING', patientConfirmedBooking: true,
      booking: bookedBooking('0599123456'), operatingData,
    });
    expect(res.action).toBe('booked');
    expect(svc.findOrCreatePatient).toHaveBeenCalledWith(expect.objectContaining({ phone: '0599123456' }));
  });

  it('confirmed + real slot + missing phone → NOT ready (need phone), no patient/appointment created', async () => {
    const res = await attemptConversationBooking({
      clinicId: CLINIC, conversationId: CONV, state: 'BOOKING', patientConfirmedBooking: true,
      booking: bookedBooking(undefined), operatingData,
    });
    expect(res.action).toBe('need_more_info');
    expect(missingOf(res)).toContain('phone');
    expect(svc.findOrCreatePatient).not.toHaveBeenCalled();
    expect(svc.createBooking).not.toHaveBeenCalled();
  });

  it('confirmed + real slot + empty phone → NOT booked', async () => {
    const res = await attemptConversationBooking({
      clinicId: CLINIC, conversationId: CONV, state: 'BOOKING', patientConfirmedBooking: true,
      booking: bookedBooking(''), operatingData,
    });
    expect(res.action).toBe('need_more_info');
    expect(missingOf(res)).toContain('phone');
    expect(svc.findOrCreatePatient).not.toHaveBeenCalled();
    expect(svc.createBooking).not.toHaveBeenCalled();
  });

  it('confirmed + real slot + whitespace-only phone → NOT booked', async () => {
    const res = await attemptConversationBooking({
      clinicId: CLINIC, conversationId: CONV, state: 'BOOKING', patientConfirmedBooking: true,
      booking: bookedBooking('   '), operatingData,
    });
    expect(res.action).toBe('need_more_info');
    expect(svc.createBooking).not.toHaveBeenCalled();
  });

  it('confirmed + real slot + invalid phone format → NOT booked', async () => {
    const res = await attemptConversationBooking({
      clinicId: CLINIC, conversationId: CONV, state: 'BOOKING', patientConfirmedBooking: true,
      booking: bookedBooking('call me'), operatingData,
    });
    expect(res.action).toBe('need_more_info');
    expect(missingOf(res)).toContain('phone');
    expect(svc.createBooking).not.toHaveBeenCalled();
  });
});