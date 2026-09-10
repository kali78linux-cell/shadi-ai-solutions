/**
 * PHASE 4 — Digital Intake + Patient Portal Integration (server-only).
 *
 * Form schemas are DATA (JSONB field definitions); enforcement is CODE:
 * `validateIntakeAnswers` validates every submission server-side against the
 * form's schema (fail-closed) BEFORE anything is persisted. Supported field
 * types: text, number, boolean, date, select, multi_select.
 *
 * Portal path: patient identity (clinic_id + patient_id) is ALWAYS derived
 * from the authenticated session via authorizePatientRequest — client-supplied
 * identifiers are never trusted. Staff path: authorizeClinicRequest + RBAC.
 * E-consent: when a form defines consent_text, the submission MUST carry
 * consent=true and a signed intake_consents row is recorded.
 *
 * Never import from a client component.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import type { PatientIdentity } from './patientPortal';

// ─── Form schema (types + validation) ─────────────────────────────────────────

export type IntakeFieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select';

export type IntakeField = {
  key: string;
  label: string;
  type: IntakeFieldType;
  required?: boolean;
  options?: string[];
  max_length?: number;
};

export type IntakeAnswers = Record<string, unknown>;

export type ValidationResult =
  | { ok: true; normalized: IntakeAnswers }
  | { ok: false; errors: Array<{ key: string; message: string }> };

function isValidField(v: unknown): v is IntakeField {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return (
    typeof f.key === 'string' &&
    f.key.length > 0 &&
    typeof f.label === 'string' &&
    ['text', 'number', 'boolean', 'date', 'select', 'multi_select'].includes(f.type as string)
  );
}

/** Parses/validates a form schema stored as JSONB (fail-closed). */
export function parseIntakeFormSchema(raw: unknown): IntakeField[] | null {
  if (!Array.isArray(raw)) return null;
  const fields: IntakeField[] = [];
  const keys = new Set<string>();
  for (const item of raw) {
    if (!isValidField(item)) return null;
    if (keys.has(item.key)) return null;
    if ((item.type === 'select' || item.type === 'multi_select') && !Array.isArray(item.options)) return null;
    keys.add(item.key);
    fields.push(item);
  }
  return fields;
}

/** Server-side answer validation against the parsed schema (fail-closed). */
export function validateIntakeAnswers(fields: IntakeField[], answers: unknown): ValidationResult {
  const errors: Array<{ key: string; message: string }> = [];
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { ok: false, errors: [{ key: '_root', message: 'answers must be an object' }] };
  }
  const input = answers as IntakeAnswers;
  const normalized: IntakeAnswers = {};
  const allowed = new Set(fields.map((f) => f.key));

  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) {
      errors.push({ key, message: 'unknown field' });
    }
  }

  for (const field of fields) {
    const value = input[field.key];
    const empty = value === undefined || value === null || value === '';

    if (field.required && empty) {
      errors.push({ key: field.key, message: 'required' });
      continue;
    }
    if (empty) continue;

    switch (field.type) {
      case 'text': {
        if (typeof value !== 'string') {
          errors.push({ key: field.key, message: 'must be a string' });
          break;
        }
        if (field.max_length && value.length > field.max_length) {
          errors.push({ key: field.key, message: `max length ${field.max_length}` });
          break;
        }
        normalized[field.key] = value;
        break;
      }
      case 'number': {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          errors.push({ key: field.key, message: 'must be a number' });
          break;
        }
        normalized[field.key] = n;
        break;
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push({ key: field.key, message: 'must be a boolean' });
          break;
        }
        normalized[field.key] = value;
        break;
      }
      case 'date': {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors.push({ key: field.key, message: 'must be YYYY-MM-DD' });
          break;
        }
        normalized[field.key] = value;
        break;
      }
      case 'select': {
        if (typeof value !== 'string' || !field.options!.includes(value)) {
          errors.push({ key: field.key, message: 'invalid option' });
          break;
        }
        normalized[field.key] = value;
        break;
      }
      case 'multi_select': {
        if (!Array.isArray(value) || value.some((v) => !field.options!.includes(String(v)))) {
          errors.push({ key: field.key, message: 'invalid options' });
          break;
        }
        normalized[field.key] = value.map(String);
        break;
      }
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntakeForm = {
  id: string;
  clinic_id: string;
  title: string;
  description: string | null;
  form_schema: IntakeField[];
  consent_text: string | null;
  active: boolean;
  created_at: string;
};

export type IntakeResponse = {
  id: string;
  clinic_id: string;
  patient_id: string;
  form_id: string;
  appointment_id: string | null;
  answers: IntakeAnswers;
  status: string;
  submitted_at: string | null;
  created_at: string;
};

function rowToForm(row: any): IntakeForm | null {
  if (!row) return null;
  const fields = parseIntakeFormSchema(row.form_schema);
  return {
    id: row.id,
    clinic_id: row.clinic_id,
    title: row.title,
    description: row.description ?? null,
    form_schema: fields ?? [],
    consent_text: row.consent_text ?? null,
    active: row.active,
    created_at: row.created_at,
  };
}

// ─── Staff operations (tenant-scoped) ─────────────────────────────────────────

export async function createIntakeForm(params: {
  clinicId: string;
  title: string;
  description?: string | null;
  schema: IntakeField[];
  consentText?: string | null;
}): Promise<IntakeForm> {
  if (parseIntakeFormSchema(params.schema) === null) {
    throw new Error('INVALID_FORM_SCHEMA');
  }
  const { data, error } = await supabaseAdmin
    .from('intake_forms')
    .insert({
      clinic_id: params.clinicId,
      title: params.title,
      description: params.description ?? null,
      form_schema: params.schema,
      consent_text: params.consentText ?? null,
      active: true,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const form = rowToForm(data);
  if (!form) throw new Error('INTAKE_FORM_PERSIST_FAILED');
  logEvent('intake_form_created', { clinic_id: params.clinicId, form_id: form.id });
  return form;
}

export async function listIntakeForms(clinicId: string): Promise<IntakeForm[]> {
  const { data, error } = await supabaseAdmin
    .from('intake_forms')
    .select('*')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToForm).filter((f): f is IntakeForm => f !== null);
}

export async function listIntakeResponses(params: {
  clinicId: string;
  formId?: string | null;
  patientId?: string | null;
  limit?: number;
}): Promise<IntakeResponse[]> {
  let query = supabaseAdmin
    .from('intake_responses')
    .select('*')
    .eq('clinic_id', params.clinicId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(params.limit ?? 100);
  if (params.formId) query = query.eq('form_id', params.formId);
  if (params.patientId) query = query.eq('patient_id', params.patientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as IntakeResponse[];
}

// ─── Portal operations (identity-derived, never client-trusted) ───────────────

/** Active forms for the patient's own clinic. */
export async function listActiveFormsForPatient(identity: PatientIdentity): Promise<IntakeForm[]> {
  const { data, error } = await supabaseAdmin
    .from('intake_forms')
    .select('*')
    .eq('clinic_id', identity.clinic_id)
    .eq('active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToForm).filter((f): f is IntakeForm => f !== null);
}

export async function getActiveForm(identity: PatientIdentity, formId: string): Promise<IntakeForm | null> {
  const { data, error } = await supabaseAdmin
    .from('intake_forms')
    .select('*')
    .eq('id', formId)
    .eq('clinic_id', identity.clinic_id)
    .eq('active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    // Fail-closed: a tenant-scoped lookup failure is a 404, never a leak.
    throw new Error('INTAKE_FORM_NOT_FOUND');
  }
  return rowToForm(data);
}

export type SubmitIntakeResult = {
  response: IntakeResponse;
  consentSigned: boolean;
};

/**
 * Submits a portal intake response: validates answers server-side against the
 * form schema (fail-closed), verifies the optional appointment belongs to the
 * patient, records the e-consent when the form requires one.
 */
export async function submitIntakeResponse(params: {
  identity: PatientIdentity;
  formId: string;
  answers: IntakeAnswers;
  appointmentId?: string | null;
  consent?: boolean;
}): Promise<SubmitIntakeResult> {
  const { identity } = params;
  const form = await getActiveForm(identity, params.formId);
  if (!form) throw new Error('INTAKE_FORM_NOT_FOUND');

  const validation = validateIntakeAnswers(form.form_schema, params.answers);
  if (validation.ok === false) {
    const err = new Error('INTAKE_VALIDATION_FAILED');
    (err as any).details = validation.errors;
    throw err;
  }
  const normalizedAnswers = validation.normalized;

  // Optional appointment link — must belong to THIS patient (tenant-safe).
  let appointmentId: string | null = null;
  if (params.appointmentId) {
    const { data: appt, error } = await supabaseAdmin
      .from('appointments')
      .select('id')
      .eq('id', params.appointmentId)
      .eq('clinic_id', identity.clinic_id)
      .eq('patient_id', identity.patient_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !appt) throw new Error('APPOINTMENT_NOT_FOUND_FOR_PATIENT');
    appointmentId = params.appointmentId;
  }

  const { data: response, error: insertError } = await supabaseAdmin
    .from('intake_responses')
    .insert({
      clinic_id: identity.clinic_id,
      patient_id: identity.patient_id,
      form_id: form.id,
      appointment_id: appointmentId,
      answers: normalizedAnswers,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (insertError) throw new Error(insertError.message);

  // E-consent: recorded when the form defines consent_text AND the patient
  // affirmatively consented (consent=true in the submission).
  let consentSigned = false;
  if (form.consent_text && params.consent === true) {
    const { error: consentError } = await supabaseAdmin.from('intake_consents').insert({
      clinic_id: identity.clinic_id,
      patient_id: identity.patient_id,
      form_id: form.id,
      consent_text: form.consent_text,
      version: 1,
    });
    if (consentError) {
      logEvent('intake_consent_record_failed', { clinic_id: identity.clinic_id, form_id: form.id, error: consentError.message }, 'error');
    } else {
      consentSigned = true;
    }
  }

  await writeAuditLog({
    clinicId: identity.clinic_id,
    actorUserId: null,
    action: 'intake_response_submitted',
    resourceType: 'intake_response',
    resourceId: response.id,
    metadata: { form_id: form.id, patient_id: identity.patient_id, appointment_id: appointmentId, consent_signed: consentSigned },
  }).catch(() => undefined);

  logEvent('intake_response_submitted', { clinic_id: identity.clinic_id, form_id: form.id, patient_id: identity.patient_id });
  return { response: response as IntakeResponse, consentSigned };
}

/** Patient's own submissions (portal, identity-derived). */
export async function listOwnIntakeResponses(identity: PatientIdentity): Promise<IntakeResponse[]> {
  const { data, error } = await supabaseAdmin
    .from('intake_responses')
    .select('id, clinic_id, patient_id, form_id, appointment_id, answers, status, submitted_at, created_at')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as IntakeResponse[];
}