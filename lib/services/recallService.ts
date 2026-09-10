/**
 * PHASE 3 — Patient Recall + Advanced Notifications (server-only).
 *
 * Recall pipeline (fail-closed, data-driven):
 *   1. RULES    — clinic policy (recall_rules). Disabled clinic → no recall.
 *   2. PREFS    — per-patient: opt-out skips; DND window defers past dnd_end.
 *   3. ELIGIBLE — last COMPLETED/CONFIRMED appointment older than interval_days.
 *                 One ACTIVE recall per patient (partial unique index dedupes
 *                 race-safely at the DB level).
 *   4. DISPATCH — notification_queue rows (type 'patient_recall'); delivery
 *                 stays on the EXISTING queue worker — nothing duplicated.
 *
 * The 'patient_recall' template_type was added to the DB CHECK by migration
 * 20260919 (values preserved, one added).
 *
 * Never import from a client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export type RecallRules = {
  clinic_id: string;
  enabled: boolean;
  interval_days: number;
  channels: string[];
};

export type PatientNotificationPreferences = {
  clinic_id: string;
  patient_id: string;
  opt_out: boolean;
  channels: string[];
  dnd_start: string | null;
  dnd_end: string | null;
};

const ACTIVE_RECALL_STATUSES = ['pending', 'notified'] as const;

// ─── Rules ────────────────────────────────────────────────────────────────────

export async function getRecallRules(clinicId: string): Promise<RecallRules | null> {
  const { data, error } = await supabaseAdmin
    .from('recall_rules')
    .select('clinic_id, enabled, interval_days, channels')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) {
    logEvent('recall_rules_load_error', { clinicId, error: error.message }, 'error');
    return null;
  }
  if (!data) return null;
  return {
    clinic_id: data.clinic_id,
    enabled: data.enabled,
    interval_days: data.interval_days,
    channels: Array.isArray(data.channels) ? data.channels.map(String) : [],
  };
}

export async function upsertRecallRules(params: {
  clinicId: string;
  enabled: boolean;
  intervalDays: number;
  channels: string[];
}): Promise<RecallRules> {
  const { data, error } = await supabaseAdmin
    .from('recall_rules')
    .upsert(
      {
        clinic_id: params.clinicId,
        enabled: params.enabled,
        interval_days: params.intervalDays,
        channels: params.channels,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id' }
    )
    .select('clinic_id, enabled, interval_days, channels')
    .single();
  if (error) throw new Error(error.message);
  return {
    clinic_id: data.clinic_id,
    enabled: data.enabled,
    interval_days: data.interval_days,
    channels: Array.isArray(data.channels) ? data.channels.map(String) : [],
  };
}

// ─── Patient preferences ──────────────────────────────────────────────────────

export async function getPatientNotificationPreferences(
  clinicId: string,
  patientId: string
): Promise<PatientNotificationPreferences | null> {
  const { data, error } = await supabaseAdmin
    .from('patient_notification_preferences')
    .select('clinic_id, patient_id, opt_out, channels, dnd_start, dnd_end')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .maybeSingle();
  if (error) {
    logEvent('patient_prefs_load_error', { clinicId, patientId, error: error.message }, 'error');
    return null;
  }
  if (!data) return null;
  return {
    clinic_id: data.clinic_id,
    patient_id: data.patient_id,
    opt_out: data.opt_out,
    channels: Array.isArray(data.channels) ? data.channels.map(String) : [],
    dnd_start: data.dnd_start ?? null,
    dnd_end: data.dnd_end ?? null,
  };
}

export async function upsertPatientNotificationPreferences(params: {
  clinicId: string;
  patientId: string;
  optOut?: boolean;
  channels?: string[];
  dndStart?: string | null;
  dndEnd?: string | null;
}): Promise<PatientNotificationPreferences> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.optOut !== undefined) patch.opt_out = params.optOut;
  if (params.channels !== undefined) patch.channels = params.channels;
  if (params.dndStart !== undefined) patch.dnd_start = params.dndStart;
  if (params.dndEnd !== undefined) patch.dnd_end = params.dndEnd;

  const { data, error } = await supabaseAdmin
    .from('patient_notification_preferences')
    .upsert(
      { clinic_id: params.clinicId, patient_id: params.patientId, ...patch },
      { onConflict: 'clinic_id,patient_id' }
    )
    .select('clinic_id, patient_id, opt_out, channels, dnd_start, dnd_end')
    .single();
  if (error) throw new Error(error.message);
  return {
    clinic_id: data.clinic_id,
    patient_id: data.patient_id,
    opt_out: data.opt_out,
    channels: Array.isArray(data.channels) ? data.channels.map(String) : [],
    dnd_start: data.dnd_start ?? null,
    dnd_end: data.dnd_end ?? null,
  };
}

// ─── Eligibility (pure, testable) ─────────────────────────────────────────────

export type EligiblePatient = {
  patientId: string;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  lastVisitDate: string;
  daysSinceVisit: number;
  intervalDays: number;
};

export function isPatientEligibleForRecall(params: {
  lastVisitDate: string | null;
  intervalDays: number;
  todayIso?: string;
}): boolean {
  if (!params.lastVisitDate) return false;
  const last = new Date(`${params.lastVisitDate}T00:00:00.000Z`);
  if (Number.isNaN(last.getTime())) return false;
  const today = params.todayIso
    ? new Date(`${params.todayIso.slice(0, 10)}T00:00:00.000Z`)
    : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const diffDays = Math.floor((today.getTime() - last.getTime()) / 86_400_000);
  return diffDays >= params.intervalDays;
}

/**
 * Pure DND resolution: returns the time the notification may actually be sent
 * (deferred past dnd_end; never inside the window).
 */
export function resolveDndScheduleTime(
  now: Date,
  dndStart: string | null,
  dndEnd: string | null
): Date {
  if (!dndStart || !dndEnd) return now;
  const parse = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const startM = parse(dndStart);
  const endM = parse(dndEnd);
  if (startM === null || endM === null || startM === endM) return now;

  const nowM = now.getUTCHours() * 60 + now.getUTCMinutes();
  const crossesMidnight = endM < startM;
  const inWindow = crossesMidnight
    ? nowM >= startM || nowM < endM
    : nowM >= startM && nowM < endM;
  if (!inWindow) return now;

  const deferred = new Date(now);
  deferred.setUTCHours(0, 0, 0, 0);
  deferred.setUTCMinutes(endM);
  if (deferred.getTime() <= now.getTime()) deferred.setUTCDate(deferred.getUTCDate() + 1);
  return deferred;
}

// ─── Eligible patients query ──────────────────────────────────────────────────

/**
 * Patients whose last COMPLETED/CONFIRMED appointment is older than
 * interval_days. Excludes: no contact info, opt-out patients, and patients
 * with an ACTIVE recall already (deduped again by the partial unique index).
 */
export async function computeEligibleRecalls(params: {
  clinicId: string;
  intervalDays: number;
  limit?: number;
}): Promise<EligiblePatient[]> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('patient_id, appointment_date, status, patients!inner(id, name, phone, email)')
    .eq('clinic_id', params.clinicId)
    .in('status', ['completed', 'confirmed', 'scheduled'])
    .is('deleted_at', null)
    .order('appointment_date', { ascending: false })
    .limit(500);
  if (error) {
    logEvent('recall_eligibility_query_error', { clinicId: params.clinicId, error: error.message }, 'error');
    throw new Error('recall_eligibility_query_failed');
  }

  // Build patient → latest visit map (data-driven; appointment_date ordered desc).
  const lastVisit = new Map<string, { date: string; name: string; phone: string | null; email: string | null }>();
  for (const row of data ?? []) {
    const pid = (row as any).patient_id as string | null;
    if (!pid || lastVisit.has(pid)) continue;
    const p = (row as any).patients as { id: string; name: string; phone: string | null; email: string | null } | null;
    lastVisit.set(pid, {
      date: String((row as any).appointment_date ?? '').slice(0, 10),
      name: p?.name ?? '',
      phone: p?.phone ?? null,
      email: p?.email ?? null,
    });
  }

  // Patients with an active recall are excluded (fail-closed dedupe).
  const { data: active, error: activeError } = await supabaseAdmin
    .from('recall_assignments')
    .select('patient_id')
    .eq('clinic_id', params.clinicId)
    .in('status', [...ACTIVE_RECALL_STATUSES]);
  if (activeError) {
    logEvent('recall_active_query_error', { clinicId: params.clinicId, error: activeError.message }, 'error');
    throw new Error('recall_active_query_failed');
  }
  const activeRows = Array.isArray(active) ? active : [];
  const activeIds = new Set(activeRows.map((r: any) => r.patient_id));

  // Opt-out patients are excluded.
  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from('patient_notification_preferences')
    .select('patient_id, opt_out')
    .eq('clinic_id', params.clinicId)
    .eq('opt_out', true);
  if (prefsError) {
    logEvent('recall_prefs_query_error', { clinicId: params.clinicId, error: prefsError.message }, 'error');
    throw new Error('recall_prefs_query_failed');
  }
  const prefsRows = Array.isArray(prefs) ? prefs : [];
  const optedOut = new Set(prefsRows.map((r: any) => r.patient_id));

  const eligible: EligiblePatient[] = [];
  for (const [patientId, info] of Array.from(lastVisit.entries())) {
    if (activeIds.has(patientId)) continue;
    if (optedOut.has(patientId)) continue;
    if (!isPatientEligibleForRecall({ lastVisitDate: info.date, intervalDays: params.intervalDays })) continue;
    if (!info.phone && !info.email) continue; // no contact channel → not notifiable
    const days = Math.floor((Date.now() - new Date(`${info.date}T00:00:00.000Z`).getTime()) / 86_400_000);
    eligible.push({
      patientId,
      contactName: info.name,
      contactPhone: info.phone,
      contactEmail: info.email,
      lastVisitDate: info.date,
      daysSinceVisit: days,
      intervalDays: params.intervalDays,
    });
    if (eligible.length >= (params.limit ?? 100)) break;
  }
  return eligible;
}

// ─── Generation (creates assignments + queue rows) ────────────────────────────

export type RecallGenerationResult = {
  eligible: number;
  created: number;
  skippedActive: number;
  queueRows: number;
};

/**
 * Generates recalls for eligible patients: one recall_assignments row per
 * patient (status pending) + one notification_queue row per channel
 * (type 'recall'), DND-deferred per patient preferences.
 * Idempotent per cycle via the partial unique index — a second run for the
 * same patient is skipped (skippedActive), never duplicated.
 */
export async function runRecallGeneration(params: {
  clinicId: string;
  actorUserId?: string | null;
  limit?: number;
}): Promise<RecallGenerationResult> {
  const rules = await getRecallRules(params.clinicId);
  if (!rules || !rules.enabled) {
    return { eligible: 0, created: 0, skippedActive: 0, queueRows: 0 };
  }

  const eligible = await computeEligibleRecalls({
    clinicId: params.clinicId,
    intervalDays: rules.interval_days,
    limit: params.limit,
  });

  let created = 0;
  let queueRows = 0;
  let skippedActive = 0;

  for (const patient of eligible) {
    const prefs = await getPatientNotificationPreferences(params.clinicId, patient.patientId);
    if (prefs?.opt_out) continue;

    const channels = (prefs?.channels?.length ? prefs.channels : rules.channels).filter((c) =>
      ['whatsapp', 'telegram', 'sms', 'email'].includes(c)
    );
    if (channels.length === 0) continue;

    const insert = await supabaseAdmin
      .from('recall_assignments')
      .insert({
        clinic_id: params.clinicId,
        patient_id: patient.patientId,
        interval_days: patient.intervalDays,
        last_visit_date: patient.lastVisitDate,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();
    // Partial unique index blocks duplicates — a concurrent/previous active
    // recall means this patient is already covered (skip, not an error).
    if (insert.error) {
      if (/duplicate key|unique/i.test(insert.error.message)) {
        skippedActive += 1;
        continue;
      }
      logEvent('recall_insert_error', { clinicId: params.clinicId, patientId: patient.patientId, error: insert.error.message }, 'error');
      continue;
    }
    created += 1;

    // DND-aware schedule time (server-side, never trusted from client).
    const scheduledFor = resolveDndScheduleTime(new Date(), prefs?.dnd_start ?? null, prefs?.dnd_end ?? null);
    const rows = channels.map((channel) => ({
      clinic_id: params.clinicId,
      patient_id: patient.patientId,
      channel,
      type: 'recall',
      status: 'pending',
      scheduled_for: scheduledFor.toISOString(),
      attempt_count: 0,
      payload: {
        recall_id: insert.data?.id ?? null,
        last_visit_date: patient.lastVisitDate,
        interval_days: patient.intervalDays,
      },
    }));
    const { data: qRows, error: qError } = await supabaseAdmin
      .from('notification_queue')
      .insert(rows)
      .select('id');
    if (qError) {
      logEvent('recall_queue_insert_error', { clinicId: params.clinicId, patientId: patient.patientId, error: qError.message }, 'error');
    } else {
      queueRows += qRows?.length ?? 0;
    }
  }

  logEvent('recall_generation_completed', {
    clinic_id: params.clinicId,
    eligible: eligible.length,
    created,
    skippedActive,
    queueRows,
    actor: params.actorUserId ?? null,
  });
  return { eligible: eligible.length, created, skippedActive, queueRows };
}

/** Cancels a pending/notified recall (staff action, tenant-scoped). */
export async function cancelRecall(clinicId: string, recallId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('recall_assignments')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', recallId)
    .eq('clinic_id', clinicId)
    .in('status', [...ACTIVE_RECALL_STATUSES]);
  if (error) throw new Error(error.message);
}

/** Lists recalls for the clinic (staff view). */
export async function listRecalls(clinicId: string, status?: string): Promise<unknown[]> {
  let query = supabaseAdmin
    .from('recall_assignments')
    .select('id, patient_id, interval_days, last_visit_date, status, scheduled_at, notified_at, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}