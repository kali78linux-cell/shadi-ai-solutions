/**
 * PHASE 2 — Smart Scheduling (server-only).
 *
 * Builds ON TOP of the closed scheduling foundation (scheduling.ts +
 * bookingService loaders) — it NEVER invents availability. Every slot derives
 * from REAL data: provider schedules, service durations, clinic holidays,
 * provider vacations, existing appointments (overlap + buffers + daily caps).
 *
 * Activity-awareness: clinic appointments (multi-service capable),
 * imaging_center requests and dental_lab cases (scheduling an activity request
 * REQUIRES a real provider schedule; without one the answer is a fail-closed
 * 'no_schedule_configured', never invented hours).
 *
 * Never import from a client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { checkSlotAvailability, suggestFreeSlots, type ProviderSchedule, type ScheduledAppointment } from './scheduling';
import {
  loadProviderSchedule,
  loadExistingAppointments,
  isClinicHoliday,
  getActiveServiceById,
  getActiveProviders,
  createBooking,
} from './bookingService';
import { applyWorkflowTransition, WorkflowTransitionError } from './workflowService';

export type RankedSuggestion = {
  rank: number;
  startsAt: string;
  providerId: string;
  score: number;
  reason: string;
};

/**
 * Scores a slot (higher = better). Deterministic, data-driven:
 *   - earlier in the day scores higher
 *   - a slot that fills a gap right after an existing appointment scores higher
 *     (reduces schedule fragmentation)
 *   - preferred window bonus; 'any'/undefined is neutral.
 */
export function rankSlots(
  slots: Array<{ startsAt: string; providerId: string }>,
  existingAppointments: ScheduledAppointment[],
  preferredWindow?: 'morning' | 'afternoon' | 'evening' | 'any' | null
): Array<{ startsAt: string; providerId: string; score: number; reason: string }> {
  const dayKey = slots[0] ? new Date(slots[0].startsAt).toISOString().slice(0, 10) : null;
  const sameDay = dayKey
    ? existingAppointments.filter((a) => a.startsAt.slice(0, 10) === dayKey)
    : existingAppointments;

  return slots
    .map((slot) => {
      const start = new Date(slot.startsAt);
      const mins = start.getUTCHours() * 60 + start.getUTCMinutes();
      let score = 100 - mins / 10; // earlier is better
      const reasons: string[] = [];

      if (preferredWindow && preferredWindow !== 'any') {
        const inWindow =
          (preferredWindow === 'morning' && mins < 720) ||
          (preferredWindow === 'afternoon' && mins >= 720 && mins < 1020) ||
          (preferredWindow === 'evening' && mins >= 1020);
        if (inWindow) {
          score += 25;
          reasons.push(`preferred_${preferredWindow}`);
        }
      }

      // gap-fill bonus: slot starts within 30 minutes after an existing appointment ends
      const gapFill = sameDay.some((a) => {
        const aEnd = new Date(new Date(a.startsAt).getTime() + a.durationMinutes * 60_000);
        const delta = start.getTime() - aEnd.getTime();
        return delta >= 0 && delta <= 30 * 60_000;
      });
      if (gapFill) {
        score += 15;
        reasons.push('fills_gap');
      }

      return { ...slot, score: Math.round(score * 10) / 10, reason: reasons.join('+') || 'earlier_first' };
    })
    .sort((a, b) => b.score - a.score || a.startsAt.localeCompare(b.startsAt));
}

// ─── Slots with buffers ───────────────────────────────────────────────────────

export type DaySlotsResult = {
  providerId: string;
  date: string;
  durationMinutes: number;
  bufferMinutes: number;
  slots: Array<{ startsAt: string; endsAt: string; reason: string }>;
};

/**
 * All bookable slots for one provider/day using the REAL schedule, REAL
 * service duration, REAL holidays/vacations and REAL appointments — with an
 * optional buffer enforced between appointments (no-overlap + buffer).
 */
export async function computeProviderDaySlots(params: {
  clinicId: string;
  providerId: string;
  date: string;
  serviceId?: string | null;
  bufferMinutes?: number;
  limit?: number;
}): Promise<DaySlotsResult> {
  const schedule: ProviderSchedule | null = await loadProviderSchedule(params.clinicId, params.providerId);
  if (!schedule) throw new Error('Provider not found for this clinic');

  let durationMinutes = schedule.appointmentDurationMinutes;
  if (params.serviceId) {
    const service = await getActiveServiceById(params.clinicId, params.serviceId);
    if (!service) throw new Error('Service not found for this clinic');
    durationMinutes = service.duration_minutes;
  }
  const bufferMinutes = Math.max(0, params.bufferMinutes ?? 0);
  const holiday = await isClinicHoliday(params.clinicId, params.date);
  const existing = await loadExistingAppointments(params.clinicId, params.providerId, params.date);

  // Enforce the buffer by inflating each existing appointment's footprint.
  const buffered: ScheduledAppointment[] = bufferMinutes
    ? existing.map((a) => ({
        ...a,
        startsAt: new Date(new Date(a.startsAt).getTime() - bufferMinutes * 60_000).toISOString(),
        durationMinutes: a.durationMinutes + bufferMinutes,
      }))
    : existing;

  const raw = suggestFreeSlots({
    date: params.date,
    schedule: { ...schedule, appointmentDurationMinutes: durationMinutes },
    existingAppointments: buffered,
    holiday,
    limit: params.limit ?? 20,
  });

  return {
    providerId: params.providerId,
    date: params.date,
    durationMinutes,
    bufferMinutes,
    slots: raw.map((startsAt) => ({
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString(),
      reason: 'available',
    })),
  };
}

// ─── Suggestions (multi-provider, ranked) ─────────────────────────────────────

export type SuggestSlotsResult = {
  clinicId: string;
  date: string;
  serviceId: string | null;
  preferredWindow: string;
  suggestions: RankedSuggestion[];
  evaluatedProviders: number;
  warnings: string[];
};

/**
 * Intelligent slot suggestions: only providers COMPATIBLE with the service
 * (via provider_services assignments when configured) are evaluated; every
 * candidate slot is validated server-side, then ranked (earlier + gap-fill +
 * preferred window). Returns the top N with scores and reasons.
 */
export async function suggestBookingSlots(params: {
  clinicId: string;
  date: string;
  serviceId?: string | null;
  providerId?: string | null;
  preferredWindow?: 'morning' | 'afternoon' | 'evening' | 'any' | null;
  bufferMinutes?: number;
  limit?: number;
}): Promise<SuggestSlotsResult> {
  const limit = params.limit ?? 5;

  // Compatible providers only (service-aware), as the system already defines.
  const providers = params.providerId
    ? [{ id: params.providerId, name: '', title: null }]
    : await getActiveProviders(params.clinicId, params.serviceId ?? undefined);

  const candidates: Array<{ startsAt: string; providerId: string }> = [];
  const warnings: string[] = [];
  let evaluated = 0;

  for (const provider of providers.slice(0, 10)) {
    try {
      const day = await computeProviderDaySlots({
        clinicId: params.clinicId,
        providerId: provider.id,
        date: params.date,
        serviceId: params.serviceId ?? null,
        bufferMinutes: params.bufferMinutes ?? 0,
        limit: 20,
      });
      evaluated += 1;
      for (const slot of day.slots) candidates.push({ startsAt: slot.startsAt, providerId: provider.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Real data problems are surfaced, never masked with invented slots.
      if (message.includes('Provider not found')) warnings.push(`${provider.id}:provider_not_found`);
      else if (message.includes('not assigned')) warnings.push(`${provider.id}:service_mismatch`);
      else if (message.includes('Service not found')) warnings.push('service_not_found');
      else warnings.push(`${provider.id}:schedule_unavailable`);
    }
  }

  const existing = params.providerId
    ? await loadExistingAppointments(params.clinicId, params.providerId, params.date)
    : [];
  const ranked = rankSlots(candidates, existing, params.preferredWindow ?? 'any');
  const durationForMeta = params.serviceId
    ? (await getActiveServiceById(params.clinicId, params.serviceId))?.duration_minutes ?? 30
    : 30;

  return {
    clinicId: params.clinicId,
    date: params.date,
    serviceId: params.serviceId ?? null,
    preferredWindow: params.preferredWindow ?? 'any',
    suggestions: ranked.slice(0, limit).map((s, i) => ({
      startsAt: s.startsAt,
      endsAt: new Date(new Date(s.startsAt).getTime() + durationForMeta * 60_000).toISOString(),
      providerId: s.providerId,
      score: s.score,
      reason: s.reason,
      rank: i + 1,
    })),
    evaluatedProviders: evaluated,
    warnings,
  };
}

// ─── Multi-service booking ────────────────────────────────────────────────────

export type MultiServicePlanItem = {
  serviceId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
};

export type MultiServicePlan = {
  clinicId: string;
  providerId: string;
  date: string;
  items: MultiServicePlanItem[];
  feasible: boolean;
  blocker?: string;
};

/**
 * Plans a chained multi-service booking: service N starts when service N-1
 * ends (+ buffer). Every hop is validated against the REAL schedule and REAL
 * appointments; the first infeasible hop reports a blocker (fail-closed).
 */
export async function computeMultiServicePlan(params: {
  clinicId: string;
  providerId: string;
  date: string;
  serviceIds: string[];
  bufferMinutes?: number;
}): Promise<MultiServicePlan> {
  const buffer = Math.max(0, params.bufferMinutes ?? 0);
  const schedule = await loadProviderSchedule(params.clinicId, params.providerId);
  if (!schedule) throw new Error('Provider not found for this clinic');
  const holiday = await isClinicHoliday(params.clinicId, params.date);
  const existing = await loadExistingAppointments(params.clinicId, params.providerId, params.date);

  const items: MultiServicePlanItem[] = [];
  const planned: ScheduledAppointment[] = [...existing];
  let cursorMs: number | null = null;

  for (const serviceId of params.serviceIds) {
    const service = await getActiveServiceById(params.clinicId, serviceId);
    if (!service) {
      return { clinicId: params.clinicId, providerId: params.providerId, date: params.date, items, feasible: false, blocker: `service_not_found:${serviceId}` };
    }

    if (cursorMs === null) {
      // First service: take the best available slot of the day.
      const day = await computeProviderDaySlots({
        clinicId: params.clinicId,
        providerId: params.providerId,
        date: params.date,
        serviceId,
        bufferMinutes: buffer,
        limit: 50,
      });
      if (day.slots.length === 0) {
        return { clinicId: params.clinicId, providerId: params.providerId, date: params.date, items, feasible: false, blocker: 'no_slots_available' };
      }
      const first = day.slots[0];
      items.push({ serviceId, startsAt: first.startsAt, endsAt: first.endsAt, durationMinutes: day.durationMinutes });
      planned.push({ providerId: params.providerId, startsAt: first.startsAt, durationMinutes: day.durationMinutes });
      cursorMs = new Date(first.endsAt).getTime() + buffer * 60_000;
      continue;
    }

    const check = checkSlotAvailability({
      startsAt: new Date(cursorMs).toISOString(),
      durationMinutes: service.duration_minutes,
      schedule,
      existingAppointments: planned,
      holiday,
    });
    if (!check.available) {
      return {
        clinicId: params.clinicId,
        providerId: params.providerId,
        date: params.date,
        items,
        feasible: false,
        blocker: `service_chain_conflict:${serviceId}:${check.reason}`,
      };
    }
    items.push({ serviceId, startsAt: new Date(cursorMs).toISOString(), endsAt: check.endsAt, durationMinutes: service.duration_minutes });
    planned.push({ providerId: params.providerId, startsAt: new Date(cursorMs).toISOString(), durationMinutes: service.duration_minutes });
    cursorMs = new Date(check.endsAt).getTime() + buffer * 60_000;
  }

  return { clinicId: params.clinicId, providerId: params.providerId, date: params.date, items, feasible: true };
}

/**
 * Books a planned multi-service chain via the EXISTING createBooking flow
 * (per-appointment validation, reminders, tokens — nothing duplicated). If a
 * mid-chain booking fails, the already-created appointments are cancelled
 * (compensating) so no half-booked chains are left behind.
 */
export async function bookMultiService(params: {
  clinicId: string;
  providerId: string;
  date: string;
  patientId: string;
  serviceIds: string[];
  bufferMinutes?: number;
  conversationId?: string | null;
}): Promise<{ plan: MultiServicePlan; appointments: Array<{ id: string; scheduled_at: string; serviceId: string }> }> {
  const plan = await computeMultiServicePlan({
    clinicId: params.clinicId,
    providerId: params.providerId,
    date: params.date,
    serviceIds: params.serviceIds,
    bufferMinutes: params.bufferMinutes,
  });
  if (!plan.feasible || plan.items.length !== params.serviceIds.length) {
    throw new Error(`Multi-service booking not feasible: ${plan.blocker ?? 'plan_mismatch'}`);
  }

  const created: Array<{ id: string; scheduled_at: string; serviceId: string }> = [];
  try {
    for (const item of plan.items) {
      const service = await getActiveServiceById(params.clinicId, item.serviceId);
      if (!service) throw new Error(`Service not found for this clinic: ${item.serviceId}`);
      const time = new Date(item.startsAt).toISOString().slice(11, 16);
      const booking = await createBooking({
        clinicId: params.clinicId,
        providerId: params.providerId,
        service: service.name,
        date: params.date,
        time,
        patientId: params.patientId,
        serviceId: item.serviceId,
        conversationId: params.conversationId ?? null,
        durationMinutes: item.durationMinutes,
      });
      created.push({ id: booking.id, scheduled_at: booking.scheduled_at, serviceId: item.serviceId });
    }
  } catch (err) {
    // Compensating cancellation — failed chains are never half-booked.
    for (const appt of created) {
      try {
        await supabaseAdmin
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', appt.id)
          .eq('clinic_id', params.clinicId);
      } catch {
        /* best-effort compensation */
      }
    }
    logEvent('multi_service_booking_compensated', { clinicId: params.clinicId, created: created.length, error: String(err) }, 'error');
    throw err;
  }

  return { plan, appointments: created };
}

// ─── Activity-aware scheduling (imaging_center / dental_lab) ─────────────────

export type ActivitySchedulingResult = {
  ok: true;
  entityType: 'imaging_requests' | 'lab_cases';
  requestId: string;
  fromStatus: string;
  scheduledAt: string;
  providerId: string;
};

/**
 * Schedules an imaging request / lab case into a REAL provider slot. This is
 * the activity-aware path: it reuses the same REAL availability primitives and
 * the PHASE 1B workflow machine (requested→scheduled for imaging), so the
 * transition is audited exactly like every other workflow transition.
 * Fail-closed: without a real provider schedule nothing is scheduled.
 */
export async function scheduleActivityRequest(params: {
  clinicId: string;
  entityType: 'imaging_requests' | 'lab_cases';
  requestId: string;
  providerId: string;
  date: string;
  time: string;
  durationMinutes?: number;
  actorUserId?: string | null;
  actorRole?: string | null;
}): Promise<ActivitySchedulingResult> {
  const { clinicId, entityType, requestId } = params;

  const schedule = await loadProviderSchedule(clinicId, params.providerId);
  if (!schedule) {
    // Fail-closed: no schedule data → no availability may be invented.
    const err = new Error('no_schedule_configured');
    logEvent('activity_schedule_no_schedule', { clinicId, entityType, requestId }, 'error');
    throw err;
  }

  const startsAt = `${params.date}T${params.time}:00.000Z`;
  const duration = params.durationMinutes ?? schedule.appointmentDurationMinutes;
  const holiday = await isClinicHoliday(clinicId, params.date);
  const existing = await loadExistingAppointments(clinicId, params.providerId, params.date);

  const availability = checkSlotAvailability({
    startsAt,
    durationMinutes: duration,
    schedule,
    existingAppointments: existing,
    holiday,
  });
  if (!availability.available) {
    throw new Error(`slot_unavailable:${availability.reason}`);
  }

  // Load current status (tenant-scoped) for the machine validation.
  const { data: row, error: rowError } = await supabaseAdmin
    .from(entityType)
    .select('status')
    .eq('id', requestId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (rowError || !row) throw new Error('entity_not_found');
  const fromStatus = String((row as { status: string }).status);

  // PHASE 1B machine: imaging_requests requested→scheduled is a REAL machine
  // edge and is audited. lab_cases have NO `scheduled` state (their workflow
  // starts at received) — scheduling a lab case sets the time columns while
  // keeping the machine-managed status untouched (documented behavior).
  if (entityType === 'imaging_requests') {
    const { validateWorkflowTransition } = await import('./workflowStates');
    const failure = validateWorkflowTransition(entityType, fromStatus, 'scheduled');
    if (failure) {
      throw new WorkflowTransitionError(failure, entityType, fromStatus, 'scheduled');
    }
    await applyWorkflowTransition({
      clinicId,
      entityType,
      entityId: requestId,
      toStatus: 'scheduled',
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole ?? null,
      reason: `scheduled to ${startsAt} with provider ${params.providerId}`,
    });
  }

  // Attach the schedule columns (guarded on the tenant).
  const { data: updated, error: updateError } = await supabaseAdmin
    .from(entityType)
    .update({ scheduled_at: startsAt, provider_id: params.providerId })
    .eq('id', requestId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .select('id, status, scheduled_at')
    .maybeSingle();
  if (updateError || !updated) {
    logEvent('activity_schedule_attach_failed', { clinicId, entityType, requestId, error: String(updateError) }, 'error');
    throw new Error('schedule_attach_failed');
  }

  logEvent('activity_request_scheduled', { clinicId, entityType, requestId, startsAt, providerId: params.providerId });
  return {
    ok: true,
    entityType,
    requestId,
    fromStatus,
    scheduledAt: startsAt,
    providerId: params.providerId,
  };
}
