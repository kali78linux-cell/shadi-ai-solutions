import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { getEmailProvider, EmailProvider } from './provider';
import { buildBookingEmail, BookingNotificationType } from './messageBuilder';
import { getAppBaseUrl } from '../links';

/**
 * Loads the data needed to build a patient-facing email for a notification queue item.
 * Returns null if the appointment, clinic, or patient email cannot be resolved.
 */
async function loadNotificationContext(notification: any) {
  const { clinic_id, appointment_id, patient_id, type } = notification;

  // Load appointment + clinic + patient in parallel
  const [appointmentRes, clinicRes, patientRes] = await Promise.all([
    supabaseAdmin
      .from('appointments')
      .select('id, clinic_id, patient_id, service, appointment_date, scheduled_at, provider_id, status, booking_token')
      .eq('id', appointment_id)
      .eq('clinic_id', clinic_id)
      .maybeSingle(),
    supabaseAdmin
      .from('clinics')
      .select('id, name')
      .eq('id', clinic_id)
      .maybeSingle(),
    patient_id
      ? supabaseAdmin
          .from('patients')
          .select('id, email')
          .eq('id', patient_id)
          .eq('clinic_id', clinic_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (appointmentRes.error || !appointmentRes.data) return null;
  if (clinicRes.error || !clinicRes.data) return null;
  if (patientRes.error || !patientRes.data) return null;

  const appointment = appointmentRes.data;
  const clinic = clinicRes.data;
  const patient = patientRes.data;

  // Resolve provider name if available
  let providerName: string | null = null;
  if (appointment.provider_id) {
    const { data: provider } = await supabaseAdmin
      .from('providers')
      .select('name')
      .eq('id', appointment.provider_id)
      .eq('clinic_id', clinic_id)
      .maybeSingle();
    providerName = provider?.name ?? null;
  }

  const scheduledAt = appointment.scheduled_at ? new Date(appointment.scheduled_at) : null;
  const date = appointment.appointment_date ?? (scheduledAt ? scheduledAt.toISOString().slice(0, 10) : '');
  const time = scheduledAt
    ? `${scheduledAt.getUTCHours().toString().padStart(2, '0')}:${scheduledAt.getUTCMinutes().toString().padStart(2, '0')}`
    : '';

  return {
    clinicName: clinic.name,
    service: appointment.service,
    date,
    time,
    providerName,
    patientEmail: patient.email,
    bookingToken: appointment.booking_token ?? '',
    clinicId: clinic_id,
    appointmentId: appointment_id,
    baseUrl: getAppBaseUrl(),
    type: type as BookingNotificationType,
  };
}

/**
 * Sends an email for a notification queue item.
 * Used as the `sender` callback in `processNotificationQueue`.
 *
 * Never logs the raw booking token.
 * Communication failure is thrown so the queue can mark the item as failed/retried.
 */
export async function sendNotificationEmail(notification: any, provider?: EmailProvider): Promise<void> {
  const emailProvider = provider ?? getEmailProvider();

  // Never send cancelled notifications
  if (notification.status === 'cancelled') {
    logEvent('email_send_skipped_cancelled', { notification_id: notification.id, clinic_id: notification.clinic_id });
    return;
  }

  // Never re-send already-sent notifications
  if (notification.status === 'sent') {
    logEvent('email_send_skipped_already_sent', { notification_id: notification.id, clinic_id: notification.clinic_id });
    return;
  }

  const context = await loadNotificationContext(notification);
  if (!context) {
    throw new Error('Unable to resolve notification context (appointment/clinic/patient)');
  }

  // Missing email address handled safely — throw so the queue marks it failed/retried
  if (!context.patientEmail) {
    throw new Error('Patient has no email address');
  }

  const email = buildBookingEmail(context, context.type);

  // Log only safe metadata — NEVER the raw token
  logEvent('email_send_attempt', {
    notification_id: notification.id,
    clinic_id: notification.clinic_id,
    appointment_id: notification.appointment_id,
    to: email.to,
    subject: email.subject,
  });

  await emailProvider.send(email);
}