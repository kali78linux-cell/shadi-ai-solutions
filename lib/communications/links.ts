/**
 * Builds a secure patient-facing URL for the booking confirmation/cancellation flow.
 *
 * Reuses the EXISTING booking token system — no new token is created.
 * The raw token is embedded in the URL because it is intended for the patient,
 * but it must NEVER be logged.
 */

export type BookingAction = 'confirm' | 'cancel';

export interface BookingLinkParams {
  /** Base URL of the application, e.g. https://app.example.com (no trailing slash) */
  baseUrl: string;
  clinicId: string;
  appointmentId: string;
  token: string;
  action: BookingAction;
}

/**
 * Builds a patient-facing URL that deep-links into the booking flow
 * with the secure token so the patient can confirm/cancel their own booking.
 */
export function buildBookingActionUrl(params: BookingLinkParams): string {
  const { baseUrl, clinicId, appointmentId, token, action } = params;
  const url = new URL('/book', baseUrl);
  url.searchParams.set('clinic_id', clinicId);
  url.searchParams.set('appointment_id', appointmentId);
  url.searchParams.set('token', token);
  url.searchParams.set('action', action);
  return url.toString();
}

/**
 * Resolves the application base URL from the environment.
 * Falls back to http://localhost:3000 in development.
 */
export function getAppBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL || env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}
