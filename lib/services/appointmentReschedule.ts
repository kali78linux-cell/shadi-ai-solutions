import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { loadProviderSchedule, getActiveServiceById, loadExistingAppointments, isClinicHoliday } from './bookingService';
import { checkSlotAvailability } from './scheduling';
import { createAppointmentReminders, cancelAppointmentReminders } from './reminderEngine';

/**
 * Validates that a provider is assigned to a service (when assignments configured).
 * Returns true if assigned, false if explicitly not assigned, null if table unavailable.
 */
async function providerAssignedToService(clinicId: string, providerId: string, serviceId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('provider_services')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('service_id', serviceId)
    .maybeSingle();

  if (error) return null; // table unavailable — fallback allowed
  return data !== null;
}

/**
 * Reschedules an existing appointment to a new date/time.
 * Validates availability, updates the appointment atomically,
 * cancels old reminders, creates new reminders, and queues a reschedule notification.
 *
 * Concurrency-safe via the partial unique index on (provider_id, scheduled_at)
 * for active statuses. If two reschedules collide, the second insert/update
 * will fail the update and throw.
 */
export async function rescheduleAppointment(params: {
  clinicId: string;
  appointmentId: string;
  date: string;
  time: string;
}): Promise<{ id: string; scheduled_at: string; appointment_date: string; status: string }> {
  const { clinicId, appointmentId, date, time } = params;

  // 1. Load the existing appointment
  const { data: appointment, error: loadError } = await supabaseAdmin
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();

  if (loadError || !appointment) {
    throw new Error('Appointment not found for this clinic');
  }

  // 2. Check eligibility
  const INELIGIBLE = new Set(['cancelled', 'completed', 'no_show']);
  if (INELIGIBLE.has(appointment.status)) {
    throw new Error(`Appointment cannot be rescheduled from status: ${appointment.status}`);
  }

  if (!appointment.provider_id) {
    throw new Error('Appointment has no provider assigned — reschedule not possible');
  }

  // 3. Resolve service duration
  let durationMinutes = appointment.duration_minutes ?? 30;
  if (appointment.service_id) {
    const service = await getActiveServiceById(clinicId, appointment.service_id);
    if (service) durationMinutes = service.duration_minutes;
  }

  // 4. Verify provider is assigned to the service (when assignments used)
  if (appointment.service_id) {
    const assigned = await providerAssignedToService(clinicId, appointment.provider_id, appointment.service_id);
    if (assigned === false) {
      throw new Error('Provider is not assigned to this service');
    }
  }

  // 5. Load schedule for chosen date
  const schedule = await loadProviderSchedule(clinicId, appointment.provider_id);
  if (!schedule) {
    throw new Error('Provider not found for this clinic');
  }

  // 6. Check availability of new slot
  const startsAt = `${date}T${time}:00.000Z`;
  const holiday = await isClinicHoliday(clinicId, date);

  // Load existing appointments EXCLUDING the one being rescheduled (so self-overlap isn't flagged)
  const existing = await loadExistingAppointments(clinicId, appointment.provider_id, date);
  const otherAppointments = existing.filter((a) => a.id !== appointment.id);

  const availability = checkSlotAvailability({
    startsAt,
    durationMinutes,
    schedule,
    existingAppointments: otherAppointments,
    holiday,
  });

  if (!availability.available) {
    throw new Error(`Requested slot is unavailable: ${availability.reason}`);
  }

  // 7. Atomically update the appointment
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('appointments')
    .update({
      appointment_date: date,
      scheduled_at: startsAt,
      duration_minutes: durationMinutes,
    })
    .eq('id', appointmentId)
    .eq('clinic_id', clinicId)
    .select('id, scheduled_at, appointment_date, status')
    .single();

  if (updateError) {
    // A unique violation on provider_id+scheduled_at indicates a concurrent booking
    if (updateError.code === '23505' || /duplicate key/i.test(updateError.message)) {
      logEvent('reschedule_concurrent_collision', { clinic_id: clinicId, appointment_id: appointmentId }, 'error');
      throw new Error('Slot was just booked by another request. Please choose another time.');
    }
    throw new Error('Failed to reschedule appointment');
  }

  // 8. Cancel old pending reminders (best-effort — communication failure must NOT fail the reschedule)
  try {
    await cancelAppointmentReminders({ clinicId, appointmentId, client: supabaseAdmin });
    logEvent('appointment_rescheduled_old_reminders_cancelled', { clinic_id: clinicId, appointment_id: appointmentId });
  } catch (reminderCancelError) {
    logEvent('appointment_rescheduled_reminder_cancel_failed', {
      clinic_id: clinicId,
      appointment_id: appointmentId,
      error: reminderCancelError instanceof Error ? reminderCancelError.message : String(reminderCancelError),
    }, 'error');
  }

  // 9. Create new reminders for the new scheduled time
  try {
    await createAppointmentReminders({
      clinicId,
      appointmentId,
      scheduledAt: startsAt,
      channels: ['email'],
      patientId: appointment.patient_id,
      client: supabaseAdmin,
    });
    logEvent('appointment_rescheduled_reminders_created', { clinic_id: clinicId, appointment_id: appointmentId });
  } catch (reminderError) {
    // Reminder creation failure must not fail the reschedule
    logEvent('appointment_rescheduled_reminders_failed', {
      clinic_id: clinicId,
      appointment_id: appointmentId,
      error: reminderError instanceof Error ? reminderError.message : String(reminderError),
    }, 'error');
  }

  // 10. Queue a rescheduling notification (best-effort)
  try {
    await supabaseAdmin.from('notification_queue').insert({
      clinic_id: clinicId,
      appointment_id: appointmentId,
      patient_id: appointment.patient_id ?? null,
      channel: 'email',
      type: 'appointment_rescheduling',
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      attempt_count: 0,
      payload: { rescheduled_date: date, rescheduled_time: time },
    });
    logEvent('appointment_rescheduled_notification_queued', { clinic_id: clinicId, appointment_id: appointmentId });
  } catch (notifyError) {
    logEvent('appointment_rescheduled_notification_failed', {
      clinic_id: clinicId,
      appointment_id: appointmentId,
      error: notifyError instanceof Error ? notifyError.message : String(notifyError),
    }, 'error');
  }

  logEvent('appointment_rescheduled', { clinic_id: clinicId, appointment_id: appointmentId, new_date: date, new_time: time });
  return updated;
}