import { randomBytes, createHash } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { createAppointmentReminders, cancelAppointmentReminders } from './reminderEngine';
import { checkSlotAvailability, suggestFreeSlots, type ProviderSchedule, type ScheduledAppointment } from './scheduling';

/**
 * Loads a provider's schedule for a given clinic from the database.
 * Returns null if the provider does not belong to the clinic.
 */
export async function loadProviderSchedule(clinicId: string, providerId: string): Promise<ProviderSchedule | null> {
  // Verify provider belongs to the clinic
  const { data: provider, error: providerError } = await supabaseAdmin
    .from('providers')
    .select('id, name')
    .eq('id', providerId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .single();

  if (providerError || !provider) {
    return null;
  }

  // Load schedule rows for the provider
  const { data: scheduleRows, error: scheduleError } = await supabaseAdmin
    .from('provider_schedules')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId);

  if (scheduleError) {
    throw new Error('Failed to load provider schedule');
  }

  // Load vacations
  const { data: vacationRows, error: vacationError } = await supabaseAdmin
    .from('provider_vacations')
    .select('vacation_date')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId);

  if (vacationError) {
    throw new Error('Failed to load provider vacations');
  }

  const days = (scheduleRows ?? []).map((row) => ({
    weekday: row.weekday,
    enabled: row.enabled,
    start: row.start_time,
    end: row.end_time,
    breaks: Array.isArray(row.breaks) ? row.breaks : [],
  }));

  const appointmentDurationMinutes = scheduleRows?.[0]?.appointment_duration_minutes ?? 30;
  const maxAppointmentsPerDay = scheduleRows?.[0]?.max_appointments_per_day ?? null;

  return {
    providerId,
    clinicId,
    days,
    vacationDates: (vacationRows ?? []).map((row) => row.vacation_date),
    appointmentDurationMinutes,
    maxAppointmentsPerDay,
  };
}

/**
 * Loads existing appointments for a provider on a given date.
 */
export async function loadExistingAppointments(clinicId: string, providerId: string, date: string): Promise<ScheduledAppointment[]> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id, provider_id, scheduled_at, duration_minutes, status')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('appointment_date', date)
    .is('deleted_at', null);

  if (error) {
    throw new Error('Failed to load existing appointments');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    providerId: row.provider_id,
    startsAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
  }));
}

/**
 * Checks if a clinic is closed on a given date (holiday).
 */
export async function isClinicHoliday(clinicId: string, date: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('clinic_holidays')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('holiday_date', date);

  if (error) {
    throw new Error('Failed to load clinic holidays');
  }

  return (data ?? []).length > 0;
}

/**
 * Returns the active services for a clinic (public-safe, no internal fields).
 */
export async function getActiveServices(clinicId: string): Promise<Array<{ id: string; name: string; description: string | null; duration_minutes: number; price: number | null }>> {
  const { data, error } = await supabaseAdmin
    .from('clinic_services')
    .select('id, name, description, duration_minutes, price')
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    throw new Error('Failed to load clinic services');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    duration_minutes: row.duration_minutes,
    price: row.price ?? null,
  }));
}

/**
 * Returns a single active service by id within a clinic, or null.
 */
export async function getActiveServiceById(clinicId: string, serviceId: string): Promise<{ id: string; name: string; duration_minutes: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('clinic_services')
    .select('id, name, duration_minutes')
    .eq('id', serviceId)
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null)
    .single();

  if (error) {
    return null;
  }

  return data;
}

/**
 * Checks whether a provider is assigned to a service within a clinic.
 * Returns true if the provider_services table has a matching row.
 * Returns null if the table doesn't exist (fallback mode).
 */
async function isProviderAssignedToService(clinicId: string, providerId: string, serviceId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from('provider_services')
    .select('id')
    .eq('clinic_id', clinicId)
    .eq('provider_id', providerId)
    .eq('service_id', serviceId)
    .maybeSingle();

  if (error) {
    // Table doesn't exist or query failed — fall back to allowing (no assignments configured)
    return null;
  }

  return data !== null;
}

/**
 * Returns active providers for a clinic that have scheduling information.
 * If serviceId is provided, filters to providers that can perform the service
 * (via provider_services link table when present; otherwise returns all active providers).
 */
export async function getActiveProviders(clinicId: string, serviceId?: string): Promise<Array<{ id: string; name: string; title: string | null }>> {
  // Load all active providers for the clinic
  let query = supabaseAdmin
    .from('providers')
    .select('id, name, title')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null);

  const { data: providers, error: providerError } = await query;
  if (providerError) {
    throw new Error('Failed to load providers');
  }

  if (!providers || providers.length === 0) {
    return [];
  }

  // Load provider schedules to filter to those with scheduling info
  const providerIds = providers.map((p) => p.id);
  const { data: schedules, error: scheduleError } = await supabaseAdmin
    .from('provider_schedules')
    .select('provider_id')
    .eq('clinic_id', clinicId)
    .in('provider_id', providerIds);

  if (scheduleError) {
    throw new Error('Failed to load provider schedules');
  }

  const providersWithSchedule = new Set((schedules ?? []).map((s) => s.provider_id));

  // If serviceId is provided, check provider_services link (if table exists)
  let providersForService: Set<string> | null = null;
  if (serviceId) {
    const { data: links, error: linkError } = await supabaseAdmin
      .from('provider_services')
      .select('provider_id')
      .eq('clinic_id', clinicId)
      .eq('service_id', serviceId);

    if (!linkError) {
      providersForService = new Set((links ?? []).map((l) => l.provider_id));
    }
    // If the table doesn't exist (error), we fall back to all providers with schedules
  }

  return providers
    .filter((p) => providersWithSchedule.has(p.id))
    .filter((p) => providersForService === null || providersForService.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, title: p.title ?? null }));
}

/**
 * Returns available slots for a provider on a given date.
 * If serviceId is provided, uses the service duration for slot calculation.
 */
export async function getAvailableSlots(clinicId: string, providerId: string, date: string, limit = 10, serviceId?: string): Promise<string[]> {
  const schedule = await loadProviderSchedule(clinicId, providerId);
  if (!schedule) {
    throw new Error('Provider not found for this clinic');
  }

  // If serviceId provided, use service duration for slot calculation
  let durationMinutes = schedule.appointmentDurationMinutes;
  if (serviceId) {
    const service = await getActiveServiceById(clinicId, serviceId);
    if (!service) {
      throw new Error('Service not found for this clinic');
    }
    durationMinutes = service.duration_minutes;

    // Verify the provider is actually assigned to this service
    // (when assignments exist). This prevents querying availability for a provider that doesn't offer the service.
    const assigned = await isProviderAssignedToService(clinicId, providerId, serviceId);
    if (assigned === false) {
      throw new Error('Provider is not assigned to this service');
    }
  }

  const holiday = await isClinicHoliday(clinicId, date);
  const existingAppointments = await loadExistingAppointments(clinicId, providerId, date);

  return suggestFreeSlots({
    date,
    schedule: { ...schedule, appointmentDurationMinutes: durationMinutes },
    existingAppointments,
    holiday,
    limit,
  });
}

/**
 * Finds or creates a patient by phone (then email) within a clinic.
 * Returns the patient id. Never returns the full patient record to callers.
 */
export async function findOrCreatePatient(params: {
  clinicId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
}): Promise<string> {
  const { clinicId, name, phone, email } = params;

  // 1. Lookup by phone
  if (phone) {
    const { data: byPhone, error: phoneError } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('phone_number', phone)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (!phoneError && byPhone) {
      return byPhone.id;
    }
  }

  // 2. Lookup by email
  if (email) {
    const { data: byEmail, error: emailError } = await supabaseAdmin
      .from('patients')
      .select('id')
      .eq('clinic_id', clinicId)
      .ilike('email', email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    if (!emailError && byEmail) {
      return byEmail.id;
    }
  }

  // 3. Create new patient
  const { data: created, error: createError } = await supabaseAdmin
    .from('patients')
    .insert({
      clinic_id: clinicId,
      full_name: name,
      email: email ?? '',
      phone_number: phone ?? null,
    })
    .select('id')
    .single();

  if (createError) {
    throw new Error('Failed to create patient record');
  }

  return created.id;
}

/**
 * Generates a cryptographically secure, non-guessable booking token.
 * Returns the raw token (returned to the patient) and its SHA-256 hash (stored).
 */
function generateBookingToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Verifies a slot is still available at booking time and creates a tentative appointment.
 * Re-checks availability to prevent double-booking between GET and POST.
 * Generates a secure booking token so the patient can later confirm/cancel without staff auth.
 */
export async function createBooking(params: {
  clinicId: string;
  providerId: string;
  service: string;
  date: string;
  time: string;
  patientId: string;
  serviceId?: string;
  durationMinutes?: number;
}): Promise<{ id: string; scheduled_at: string; status: string; booking_token: string }> {
  const { clinicId, providerId, service, date, time, patientId, serviceId, durationMinutes } = params;

  const schedule = await loadProviderSchedule(clinicId, providerId);
  if (!schedule) {
    throw new Error('Provider not found for this clinic');
  }

  // Resolve duration: explicit durationMinutes > service catalog duration > provider schedule default
  let resolvedDuration = durationMinutes ?? schedule.appointmentDurationMinutes;
  if (serviceId) {
    const service = await getActiveServiceById(clinicId, serviceId);
    if (!service) {
      throw new Error('Service not found for this clinic');
    }
    resolvedDuration = service.duration_minutes;

    // Verify the provider is actually assigned to this service
    // (when assignments exist). This prevents booking a provider for a service they don't offer.
    const assigned = await isProviderAssignedToService(clinicId, providerId, serviceId);
    if (assigned === false) {
      throw new Error('Provider is not assigned to this service');
    }
  }

  const startsAt = `${date}T${time}:00.000Z`;
  const holiday = await isClinicHoliday(clinicId, date);
  const existingAppointments = await loadExistingAppointments(clinicId, providerId, date);

  // Re-check availability at booking time
  const availability = checkSlotAvailability({
    startsAt,
    durationMinutes: resolvedDuration,
    schedule,
    existingAppointments,
    holiday,
  });

  if (!availability.available) {
    throw new Error(`Slot unavailable: ${availability.reason}`);
  }

  const { token, tokenHash } = generateBookingToken();

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .insert({
      clinic_id: clinicId,
      provider_id: providerId,
      patient_id: patientId,
      service,
      appointment_date: date,
      scheduled_at: startsAt,
      duration_minutes: resolvedDuration,
      status: 'tentative',
      booking_token: tokenHash,
    })
    .select('id, scheduled_at, status')
    .single();

  if (error) {
    // Detect unique constraint violation (race condition — slot was booked concurrently)
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      throw new Error('Slot unavailable: concurrent booking');
    }
    throw new Error('Failed to create appointment');
  }

  // Schedule appointment reminders (best-effort — communication failure must NOT fail the booking)
  try {
    await createAppointmentReminders({
      clinicId,
      appointmentId: data.id,
      scheduledAt: startsAt,
      channels: ['email', 'sms'],
      patientId,
      client: supabaseAdmin,
    });
    logEvent('booking_acknowledgement_scheduled', { clinic_id: clinicId, appointment_id: data.id });
  } catch (commError) {
    logEvent('booking_acknowledgement_failure', {
      clinic_id: clinicId,
      appointment_id: data.id,
      error: commError instanceof Error ? commError.message : String(commError),
    }, 'error');
  }

  return { ...data, booking_token: token };
}

/**
 * Loads a public appointment by clinic + id + token hash.
 * Returns null if the appointment does not exist, is not in the clinic,
 * or the token does not match. Never returns sensitive patient data.
 */
async function loadPublicAppointment(clinicId: string, appointmentId: string, token: string): Promise<{ id: string; status: string } | null> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id, status')
    .eq('clinic_id', clinicId)
    .eq('id', appointmentId)
    .eq('booking_token', tokenHash)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return { id: data.id, status: data.status };
}

/**
 * Confirms a public booking (tentative → confirmed).
 * Requires the secure booking token. Clinic-scoped and appointment-scoped.
 * Returns only public-safe data.
 */
export async function confirmPublicBooking(params: { clinicId: string; appointmentId: string; token: string }): Promise<{ id: string; status: string }> {
  const { clinicId, appointmentId, token } = params;

  const appointment = await loadPublicAppointment(clinicId, appointmentId, token);
  if (!appointment) {
    throw new Error('Appointment not found');
  }

  if (appointment.status === 'confirmed') {
    throw new Error('Appointment already confirmed');
  }

  if (appointment.status !== 'tentative') {
    throw new Error('Appointment cannot be confirmed');
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('clinic_id', clinicId)
    .eq('id', appointmentId)
    .eq('booking_token', createHash('sha256').update(token).digest('hex'))
    .select('id, status')
    .single();

  if (error) {
    throw new Error('Failed to confirm appointment');
  }

  // Confirmation communication (best-effort — communication failure must NOT fail the confirmation)
  try {
    await supabaseAdmin.from('notification_queue').insert({
      clinic_id: clinicId,
      appointment_id: appointmentId,
      channel: 'email',
      type: 'appointment_confirmation',
      payload: { status: 'confirmed' },
      status: 'pending',
      scheduled_for: new Date(Date.now() + 60 * 1000).toISOString(),
    });
    logEvent('booking_confirmation_communication_scheduled', { clinic_id: clinicId, appointment_id: appointmentId });
  } catch (commError) {
    logEvent('booking_confirmation_communication_failure', {
      clinic_id: clinicId,
      appointment_id: appointmentId,
      error: commError instanceof Error ? commError.message : String(commError),
    }, 'error');
  }

  return { id: data.id, status: data.status };
}

/**
 * Reschedules a patient's own appointment via the public portal.
 * Requires the secure booking token — no staff authentication.
 * Verifies ownership (clinic + token hash), then re-checks availability
 * and atomically updates the appointment. Returns only public-safe data.
 */
export async function reschedulePublicBooking(params: {
  clinicId: string;
  appointmentId: string;
  token: string;
  date: string;
  time: string;
}): Promise<{ id: string; scheduled_at: string; appointment_date: string; status: string }> {
  const { clinicId, appointmentId, token, date, time } = params;

  // 1. Verify ownership: appointment must exist in this clinic with this token hash.
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data: appointment, error: loadError } = await supabaseAdmin
    .from('appointments')
    .select('id, status, provider_id')
    .eq('clinic_id', clinicId)
    .eq('id', appointmentId)
    .eq('booking_token', tokenHash)
    .is('deleted_at', null)
    .maybeSingle();

  if (loadError || !appointment) {
    throw new Error('Appointment not found');
  }

  // 2. Status eligibility
  const INELIGIBLE = new Set(['cancelled', 'completed', 'no_show']);
  if (INELIGIBLE.has(appointment.status)) {
    throw new Error(`Appointment cannot be rescheduled from status: ${appointment.status}`);
  }

  if (!appointment.provider_id) {
    throw new Error('Appointment has no provider assigned — reschedule not possible');
  }

  // 3. Use existing atomic, availability-checking reschedule service.
  // It re-validates clinic scoping, provider/service context, availability
  // (against other appointments), and updates atomically (race-safe).
  const { rescheduleAppointment } = await import('./appointmentReschedule');
  const updated = await rescheduleAppointment({ clinicId, appointmentId, date, time });
  return updated;
}

/**
 * Cancels a public booking (tentative/confirmed → cancelled).
 * Requires the secure booking token. Clinic-scoped and appointment-scoped.
 * Returns only public-safe data.
 */
export async function cancelPublicBooking(params: { clinicId: string; appointmentId: string; token: string }): Promise<{ id: string; status: string }> {
  const { clinicId, appointmentId, token } = params;

  const appointment = await loadPublicAppointment(clinicId, appointmentId, token);
  if (!appointment) {
    throw new Error('Appointment not found');
  }

  if (appointment.status === 'cancelled') {
    throw new Error('Appointment already cancelled');
  }

  if (appointment.status !== 'tentative' && appointment.status !== 'confirmed') {
    throw new Error('Appointment cannot be cancelled');
  }

  const { data, error } = await supabaseAdmin
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('clinic_id', clinicId)
    .eq('id', appointmentId)
    .eq('booking_token', createHash('sha256').update(token).digest('hex'))
    .select('id, status')
    .single();

  if (error) {
    throw new Error('Failed to cancel appointment');
  }

  // Cancel pending reminders (best-effort — failure must NOT fail the cancellation)
  try {
    await cancelAppointmentReminders({
      clinicId,
      appointmentId,
      client: supabaseAdmin,
    });
    logEvent('booking_cancellation_reminders_cancelled', { clinic_id: clinicId, appointment_id: appointmentId });
  } catch (commError) {
    logEvent('booking_cancellation_reminder_cancel_failure', {
      clinic_id: clinicId,
      appointment_id: appointmentId,
      error: commError instanceof Error ? commError.message : String(commError),
    }, 'error');
  }

  return { id: data.id, status: data.status };
}
