import { buildBookingActionUrl } from '../links';

export type BookingNotificationType = 'booking_acknowledgement' | 'appointment_confirmation' | 'appointment_cancellation' | 'appointment_reminder';

export interface BookingNotificationContext {
  clinicName: string;
  service: string;
  date: string;
  time: string;
  providerName: string | null;
  patientEmail: string;
  bookingToken: string;
  clinicId: string;
  appointmentId: string;
  baseUrl: string;
}

export interface EmailContent {
  to: string;
  subject: string;
  text: string;
}

/**
 * Builds a patient-facing email from a booking notification context.
 * Always includes a secure confirm/cancel link using the EXISTING booking token.
 */
export function buildBookingEmail(context: BookingNotificationContext, type: BookingNotificationType): EmailContent {
  const { clinicName, service, date, time, providerName, patientEmail, bookingToken, clinicId, appointmentId, baseUrl } = context;

  const confirmUrl = buildBookingActionUrl({ baseUrl, clinicId, appointmentId, token: bookingToken, action: 'confirm' });
  const cancelUrl = buildBookingActionUrl({ baseUrl, clinicId, appointmentId, token: bookingToken, action: 'cancel' });

  const details = [
    `Clinic: ${clinicName}`,
    `Service: ${service}`,
    `Date: ${date}`,
    `Time: ${time}`,
    providerName ? `Provider: ${providerName}` : null,
  ].filter(Boolean).join('\n');

  let subject: string;
  let body: string;

  switch (type) {
    case 'booking_acknowledgement':
      subject = `Booking Received — ${clinicName}`;
      body = [
        `Your booking request has been received.`,
        ``,
        details,
        ``,
        `Booking status: tentative (pending confirmation)`,
        ``,
        `To confirm your appointment: ${confirmUrl}`,
        `To cancel your appointment: ${cancelUrl}`,
      ].join('\n');
      break;

    case 'appointment_confirmation':
      subject = `Appointment Confirmed — ${clinicName}`;
      body = [
        `Your appointment has been confirmed.`,
        ``,
        details,
        ``,
        `Booking status: confirmed`,
        ``,
        `If you need to cancel: ${cancelUrl}`,
      ].join('\n');
      break;

    case 'appointment_cancellation':
      subject = `Appointment Cancelled — ${clinicName}`;
      body = [
        `Your appointment has been cancelled.`,
        ``,
        details,
        ``,
        `Booking status: cancelled`,
        ``,
        `If this was a mistake, you can book a new appointment through the clinic portal.`,
      ].join('\n');
      break;

    case 'appointment_reminder':
      subject = `Reminder — ${service} at ${clinicName}`;
      body = [
        `This is a reminder for your upcoming appointment.`,
        ``,
        details,
        ``,
        `If you need to cancel or reschedule: ${cancelUrl}`,
      ].join('\n');
      break;

    default:
      subject = `Update — ${clinicName}`;
      body = [
        `Update regarding your appointment.`,
        ``,
        details,
      ].join('\n');
  }

  return { to: patientEmail, subject, text: body };
}