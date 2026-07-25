import { supabase } from '@/lib/supabase';
import { detectConversationIntelligence } from '@/lib/ai/intelligence';
import { checkSlotAvailability, getCalendarRange, suggestFreeSlots, type ProviderSchedule, type ScheduledAppointment } from './scheduling';
import { recordAppointmentBooked } from './conversationIntelligence';
import { createAppointmentReminders } from './reminderEngine';

export type AppointmentBookingPlan = {
  intent: string;
  confidence: number;
  suggestions: string[];
  recommendedSlot: string | null;
  appointment: ReturnType<typeof detectConversationIntelligence>['appointment'];
};

export type AppointmentBookingFlowParams = {
  clinicId: string;
  providerId: string;
  patientId?: string | null;
  service: string;
  message: string;
  date: string;
  schedule: ProviderSchedule;
  durationMinutes?: number;
  conversationId?: string | null;
  reminderChannels?: string[];
  reminderOffsets?: number[];
  existingAppointments?: ScheduledAppointment[];
  clinicClosed?: boolean;
  holiday?: boolean;
  intervalMinutes?: number;
  limit?: number;
};

export async function listAppointments(params: { clinicId: string; view?: 'day' | 'week' | 'month'; date?: string; status?: string; providerId?: string; from?: string; to?: string }) {
  const range = params.date && params.view ? getCalendarRange(params.date, params.view) : null;
  let query = supabase.from('appointments').select('*').eq('clinic_id', params.clinicId).order('scheduled_at', { ascending: true });
  if (range) query = query.gte('scheduled_at', range.start).lt('scheduled_at', range.end);
  if (params.from) query = query.gte('scheduled_at', params.from);
  if (params.to) query = query.lt('scheduled_at', params.to);
  if (params.status) query = query.eq('status', params.status);
  if (params.providerId) query = query.eq('provider_id', params.providerId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function findAvailability(params: { clinicId: string; date: string; schedule: ProviderSchedule; existingAppointments?: ScheduledAppointment[]; clinicClosed?: boolean; holiday?: boolean; limit?: number }) {
  return suggestFreeSlots(params);
}

export function buildAppointmentBookingPlan(params: {
  message: string;
  date: string;
  schedule: ProviderSchedule;
  existingAppointments?: ScheduledAppointment[];
  clinicClosed?: boolean;
  holiday?: boolean;
  intervalMinutes?: number;
  limit?: number;
  confidenceThreshold?: number;
}): AppointmentBookingPlan {
  const intelligence = detectConversationIntelligence(params.message, params.confidenceThreshold ?? 0.65);
  if (intelligence.intent !== 'appointment_booking' && intelligence.intent !== 'appointment_reschedule') {
    throw new Error(`Appointment flow is not available for intent: ${intelligence.intent}`);
  }

  const suggestions = suggestFreeSlots({
    date: params.date,
    schedule: params.schedule,
    existingAppointments: params.existingAppointments,
    clinicClosed: params.clinicClosed,
    holiday: params.holiday,
    intervalMinutes: params.intervalMinutes,
    limit: params.limit ?? 3,
  });

  if (!suggestions.length) {
    throw new Error('No available slots for the requested appointment date');
  }

  return {
    intent: intelligence.intent,
    confidence: intelligence.confidence,
    suggestions,
    recommendedSlot: suggestions[0] ?? null,
    appointment: intelligence.appointment,
  };
}

export async function runAppointmentBookingFlow(params: AppointmentBookingFlowParams) {
  const plan = buildAppointmentBookingPlan({
    message: params.message,
    date: params.date,
    schedule: params.schedule,
    existingAppointments: params.existingAppointments,
    clinicClosed: params.clinicClosed,
    holiday: params.holiday,
    intervalMinutes: params.intervalMinutes,
    limit: params.limit ?? 3,
  });

  const slot = params.date ? plan.recommendedSlot : null;
  if (!slot) throw new Error('No available slots for the requested appointment date');

  const availability = checkSlotAvailability({
    startsAt: slot,
    durationMinutes: params.durationMinutes ?? params.schedule.appointmentDurationMinutes,
    schedule: params.schedule,
    existingAppointments: params.existingAppointments,
    clinicClosed: params.clinicClosed,
    holiday: params.holiday,
  });

  if (!availability.available) {
    throw new Error(`Appointment unavailable: ${availability.reason}`);
  }

  const appointment = {
    id: `local-${Date.now()}`,
    clinic_id: params.clinicId,
    provider_id: params.providerId,
    patient_id: params.patientId ?? null,
    service: params.service,
    scheduled_at: slot,
    appointment_date: params.date,
    duration_minutes: params.durationMinutes ?? params.schedule.appointmentDurationMinutes,
    status: 'tentative',
  };

  if (params.reminderChannels?.length) {
    await createAppointmentReminders({
      clinicId: params.clinicId,
      appointmentId: appointment.id,
      scheduledAt: slot,
      channels: params.reminderChannels,
      patientId: params.patientId ?? null,
      customOffsets: params.reminderOffsets,
    });
  }

  if (params.conversationId) {
    await recordAppointmentBooked(supabase, {
      clinicId: params.clinicId,
      conversationId: params.conversationId,
      appointmentId: appointment.id,
    });
  }

  return {
    plan,
    appointment,
    reminderJobsCreated: params.reminderChannels?.length ? true : false,
  };
}

export async function createTentativeAppointment(params: { clinicId: string; providerId: string; patientId?: string | null; service: string; startsAt: string; durationMinutes: number; schedule: ProviderSchedule; conversationId?: string | null; reminderChannels?: string[]; reminderOffsets?: number[] }) {
  const existing = await listAppointments({ clinicId: params.clinicId, providerId: params.providerId, date: params.startsAt.slice(0, 10), view: 'day' });
  const availability = checkSlotAvailability({ startsAt: params.startsAt, durationMinutes: params.durationMinutes, schedule: params.schedule, existingAppointments: existing.map((item) => ({ id: item.id, providerId: item.provider_id, startsAt: item.scheduled_at, durationMinutes: item.duration_minutes, status: item.status })) });
  if (!availability.available) throw new Error(`Appointment unavailable: ${availability.reason}`);
  const { data, error } = await supabase.from('appointments').insert([{
    clinic_id: params.clinicId,
    provider_id: params.providerId,
    patient_id: params.patientId ?? null,
    service: params.service,
    scheduled_at: params.startsAt,
    appointment_date: params.startsAt,
    duration_minutes: params.durationMinutes,
    status: 'tentative',
  }]).select('*').single();
  if (error) throw error;

  if (params.reminderChannels?.length) {
    await createAppointmentReminders({
      clinicId: params.clinicId,
      appointmentId: data.id,
      scheduledAt: params.startsAt,
      channels: params.reminderChannels,
      patientId: params.patientId ?? null,
      customOffsets: params.reminderOffsets,
    });
  }

  return data;
}

export async function confirmAppointment(params: { clinicId: string; appointmentId: string; conversationId?: string | null }) {
  const { data, error } = await supabase.from('appointments').update({ status: 'confirmed' }).eq('id', params.appointmentId).eq('clinic_id', params.clinicId).select('*').single();
  if (error) throw error;
  if (params.conversationId) await recordAppointmentBooked(supabase, { clinicId: params.clinicId, conversationId: params.conversationId, appointmentId: params.appointmentId });
  return data;
}

export async function updateAppointmentStatus(clinicId: string, appointmentId: string, status: string) {
  const { data, error } = await supabase.from('appointments').update({ status }).eq('clinic_id', clinicId).eq('id', appointmentId).select('*').single();
  if (error) throw error;
  return data;
}
