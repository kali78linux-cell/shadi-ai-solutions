export type ScheduleDay = {
  weekday: number;
  enabled: boolean;
  start: string;
  end: string;
  breaks?: Array<{ start: string; end: string }>;
};

export type ProviderSchedule = {
  providerId: string;
  clinicId: string;
  days: ScheduleDay[];
  vacationDates?: string[];
  appointmentDurationMinutes: number;
  maxAppointmentsPerDay?: number | null;
};

export type ScheduledAppointment = {
  id?: string;
  providerId?: string | null;
  startsAt: string;
  durationMinutes: number;
  status?: string;
};

export type AvailabilityReason = 'available' | 'invalid_duration' | 'provider_unavailable' | 'clinic_closed' | 'holiday' | 'vacation' | 'outside_working_hours' | 'break_time' | 'overlap' | 'maximum_daily_appointments';

export type AvailabilityResult = { available: boolean; reason: AvailabilityReason; endsAt: string };

const ACTIVE_STATUSES = new Set(['scheduled', 'tentative', 'confirmed']);

function minutes(time: string) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseLocalDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid appointment date');
  return parsed;
}

export function getCalendarRange(date: string, view: 'day' | 'week' | 'month') {
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid calendar date');
  const end = new Date(start);
  if (view === 'day') end.setUTCDate(end.getUTCDate() + 1);
  if (view === 'week') {
    const day = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - day);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 7);
  }
  if (view === 'month') {
    start.setUTCDate(1);
    end.setUTCFullYear(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export function checkSlotAvailability(params: {
  startsAt: string;
  durationMinutes: number;
  schedule: ProviderSchedule;
  existingAppointments?: ScheduledAppointment[];
  clinicClosed?: boolean;
  holiday?: boolean;
}): AvailabilityResult {
  const start = parseLocalDateTime(params.startsAt);
  const duration = params.durationMinutes;
  const end = new Date(start.getTime() + duration * 60_000);
  const endsAt = end.toISOString();
  if (!Number.isInteger(duration) || duration <= 0) return { available: false, reason: 'invalid_duration', endsAt };
  if (params.clinicClosed) return { available: false, reason: 'clinic_closed', endsAt };
  if (params.holiday) return { available: false, reason: 'holiday', endsAt };

  const key = dateKey(start);
  if (params.schedule.vacationDates?.includes(key)) return { available: false, reason: 'vacation', endsAt };
  const day = params.schedule.days.find((item) => item.weekday === start.getUTCDay());
  if (!day || !day.enabled) return { available: false, reason: 'provider_unavailable', endsAt };

  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();
  if (startMinutes < minutes(day.start) || endMinutes > minutes(day.end) || end.getUTCDate() !== start.getUTCDate()) return { available: false, reason: 'outside_working_hours', endsAt };
  if (day.breaks?.some((breakTime) => startMinutes < minutes(breakTime.end) && endMinutes > minutes(breakTime.start))) return { available: false, reason: 'break_time', endsAt };

  const existing = (params.existingAppointments ?? []).filter((appointment) => appointment.status === undefined || ACTIVE_STATUSES.has(appointment.status));
  const dailyCount = existing.filter((appointment) => dateKey(parseLocalDateTime(appointment.startsAt)) === key).length;
  if (params.schedule.maxAppointmentsPerDay !== undefined && params.schedule.maxAppointmentsPerDay !== null && dailyCount >= params.schedule.maxAppointmentsPerDay) return { available: false, reason: 'maximum_daily_appointments', endsAt };
  if (existing.some((appointment) => (() => {
    const appointmentStart = parseLocalDateTime(appointment.startsAt);
    const appointmentEnd = new Date(appointmentStart.getTime() + appointment.durationMinutes * 60_000);
    return appointmentStart < end && appointmentEnd > start;
  })())) return { available: false, reason: 'overlap', endsAt };

  return { available: true, reason: 'available', endsAt };
}

export function suggestFreeSlots(params: {
  date: string;
  schedule: ProviderSchedule;
  existingAppointments?: ScheduledAppointment[];
  clinicClosed?: boolean;
  holiday?: boolean;
  intervalMinutes?: number;
  limit?: number;
}) {
  const day = params.schedule.days.find((item) => item.weekday === new Date(`${params.date}T00:00:00Z`).getUTCDay());
  if (!day?.enabled) return [];
  const interval = params.intervalMinutes ?? params.schedule.appointmentDurationMinutes;
  const limit = params.limit ?? 10;
  const slots: string[] = [];
  for (let cursor = minutes(day.start); cursor + params.schedule.appointmentDurationMinutes <= minutes(day.end); cursor += interval) {
    const hours = String(Math.floor(cursor / 60)).padStart(2, '0');
    const mins = String(cursor % 60).padStart(2, '0');
    const result = checkSlotAvailability({
      startsAt: `${params.date}T${hours}:${mins}:00.000Z`,
      durationMinutes: params.schedule.appointmentDurationMinutes,
      schedule: params.schedule,
      existingAppointments: params.existingAppointments,
      clinicClosed: params.clinicClosed,
      holiday: params.holiday,
    });
    if (result.available) slots.push(`${params.date}T${hours}:${mins}:00.000Z`);
    if (slots.length >= limit) break;
  }
  return slots;
}
