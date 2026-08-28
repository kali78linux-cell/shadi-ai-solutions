/**
 * Client-side mirror of the booking API phone contract.
 *
 * Finding C (STEP 10 fix): the booking UI used to submit `phone: null` while
 * `POST /api/booking` requires a valid phone string (Zod min 5 / max 30 +
 * `isValidBookingPhone`), producing a generic `Invalid booking request` error.
 * The UI must reject a missing/invalid phone BEFORE any POST with a clear
 * message. Rules here MUST stay in sync with
 * `lib/services/bookingService.ts > isValidBookingPhone`.
 */
export function validateBookingPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 30) return null;
  // Digits with optional leading + and common separators; no letters/symbols.
  if (!/^\+?[0-9()[\]\s-]{4,29}$/.test(trimmed) || !/\d/.test(trimmed)) return null;
  return trimmed;
}
