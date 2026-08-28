import { describe, expect, it, vi } from 'vitest';

// bookingService pulls server-only modules; stub them so we can import the REAL
// `isValidBookingPhone` and prove the client helper mirrors the API contract.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));
vi.mock('../services/reminderEngine', () => ({
  createAppointmentReminders: vi.fn(),
  cancelAppointmentReminders: vi.fn(),
}));
vi.mock('../services/scheduling', () => ({
  checkSlotAvailability: vi.fn(),
  suggestFreeSlots: vi.fn(),
}));

import { isValidBookingPhone } from '@/lib/services/bookingService';
import { validateBookingPhone } from '@/lib/booking/bookingPhone';

/**
 * FIX C regression — Booking phone contract.
 *
 * Before: ChatInterface submitted `phone: patientPhone || null` while
 * `POST /api/booking` requires a valid phone → user saw a generic
 * `Invalid booking request` (400) after choosing service/provider/slot.
 *
 * After: the client validates the phone BEFORE any POST and shows a clear
 * message; the API schema itself is untouched.
 */
describe('FIX C — booking phone contract (client-side guard mirrors API)', () => {
  it('rejects missing/empty/blank phone client-side (no POST)', () => {
    expect(validateBookingPhone(null)).toBeNull();
    expect(validateBookingPhone(undefined)).toBeNull();
    expect(validateBookingPhone('')).toBeNull();
    expect(validateBookingPhone('   ')).toBeNull();
  });

  it('rejects malformed phone client-side', () => {
    expect(validateBookingPhone('abc')).toBeNull(); // letters only
    expect(validateBookingPhone('123')).toBeNull(); // too short
    expect(validateBookingPhone('1'.repeat(31))).toBeNull(); // too long
  });

  it('accepts a valid synthetic phone and returns the trimmed value for the payload', () => {
    expect(validateBookingPhone('+970599123456')).toBe('+970599123456');
    expect(validateBookingPhone('  0599123456  ')).toBe('0599123456');
    expect(validateBookingPhone('+970 (59) 912-3456')).toBe('+970 (59) 912-3456');
  });

  it('stays in sync with the API predicate (isValidBookingPhone) on a boundary corpus', () => {
    const corpus = [
      null, undefined, '', '   ', 'abc', '123', '12345', '0599123456',
      '+970599123456', '+970 (59) 912-3456', '1'.repeat(30), '1'.repeat(31),
      '0599-123-456', '0599123456ext', '①②③④⑤',
    ];
    for (const raw of corpus) {
      const client = validateBookingPhone(raw);
      const api = typeof raw === 'string' ? isValidBookingPhone(raw) : false;
      expect(Boolean(client), `mismatch for ${JSON.stringify(raw)?.slice(0, 6)}…`).toBe(api);
    }
  });
});
