import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 4 — Digital Intake tests: server-side answers validation (fail-closed),
// schema parsing failures, and submitIntakeResponse (identity-derived,
// tenant-scoped appointment, e-consent, audit).

const state = vi.hoisted(() => ({
  form: {} as any,
  formError: null as any,
  appointment: {} as any,
  response: {} as any,
  consentError: null as any,
  forms: [] as any[],
  responses: [] as any[],
  singleForm: false,
  insertResponse: false,
}));

const mockDb = vi.hoisted(() => {
  function chain(get: () => any) {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.order = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.insert = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve(get()));
    c.single = vi.fn(() => Promise.resolve(get()));
    c.then = (res: any, rej: any) => Promise.resolve(get()).then(res, rej);
    return c;
  }
  const forms = chain(() => ({ data: state.forms, error: null }));
  const formSingle = chain(() => ({ data: state.form, error: state.formError }));
  const appointment = chain(() => state.appointment);
  const responsesInsert = chain(() => state.response);
  const consents = chain(() => ({ data: null, error: state.consentError }));
  const ownResponses = chain(() => ({ data: state.responses, error: null }));
  return {
    from: vi.fn((t: string) => {
      if (t === 'intake_forms') return state.singleForm ? formSingle : forms;
      if (t === 'appointments') return appointment;
      if (t === 'intake_responses') return state.insertResponse ? responsesInsert : ownResponses;
      if (t === 'intake_consents') return consents;
      return forms;
    }),
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));
vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: vi.fn(async () => undefined) }));

import {
  parseIntakeFormSchema,
  validateIntakeAnswers,
  submitIntakeResponse,
} from '@/lib/services/intakeService';

const identity = { id: 'ident-1', clinic_id: 'c1', patient_id: 'p1', email: 'p@x.com' };

function makeForm(): any {
  return {
    id: 'f1', clinic_id: 'c1', title: 'Intake', description: null,
    form_schema: [
      { key: 'full_name', label: 'Name', type: 'text', required: true, max_length: 100 },
      { key: 'age', label: 'Age', type: 'number', required: true },
      { key: 'has_allergies', label: 'Allergies?', type: 'boolean', required: false },
      { key: 'birth_date', label: 'DOB', type: 'date', required: false },
      { key: 'gender', label: 'Gender', type: 'select', options: ['male', 'female'], required: true },
      { key: 'symptoms', label: 'Symptoms', type: 'multi_select', options: ['pain', 'swelling'], required: false },
    ],
    consent_text: 'I consent to treatment.', active: true, created_at: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.form = makeForm();
  state.formError = null;
  state.appointment = { data: { id: 'a1' }, error: null };
  state.response = {
    data: { id: 'r1', clinic_id: 'c1', patient_id: 'p1', form_id: 'f1', appointment_id: null, answers: {}, status: 'submitted', submitted_at: '2026-09-03T00:00:00Z', created_at: '2026-09-03T00:00:00Z' },
    error: null,
  };
  state.consentError = null;
  state.forms = [];
  state.responses = [];
  state.singleForm = false;
  state.insertResponse = false;
});

describe('PHASE 4 — schema parsing (fail-closed)', () => {
  it('accepts a valid schema and preserves field order', () => {
    const schema = makeForm().form_schema;
    expect(parseIntakeFormSchema(schema)).toEqual(schema);
  });

  it('rejects duplicate keys', () => {
    expect(
      parseIntakeFormSchema([
        { key: 'a', label: 'A', type: 'text' },
        { key: 'a', label: 'A2', type: 'text' },
      ])
    ).toBeNull();
  });

  it('rejects an unknown field type', () => {
    expect(parseIntakeFormSchema([{ key: 'a', label: 'A', type: 'json' as any }])).toBeNull();
  });

  it('rejects a non-array schema', () => {
    expect(parseIntakeFormSchema({} as any)).toBeNull();
    expect(parseIntakeFormSchema('x' as any)).toBeNull();
  });

  it('rejects a select without options', () => {
    expect(parseIntakeFormSchema([{ key: 'a', label: 'A', type: 'select' }])).toBeNull();
  });
});

describe('PHASE 4 — answers validation (server-side, fail-closed)', () => {
  const fields = makeForm().form_schema;

  it('accepts valid answers and normalizes numbers', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'male', symptoms: ['pain'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.age).toBe(30);
  });

  it('rejects a missing required field', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', gender: 'male' }); // age required & missing
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.errors.some((e) => e.key === 'age')).toBe(true);
  });

  it('rejects an unknown field', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'male', hacker: 'x' });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.errors.some((e) => e.key === 'hacker')).toBe(true);
  });

  it('rejects an invalid select option', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'other' });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid multi_select options', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'male', symptoms: ['not-an-option'] });
    expect(r.ok).toBe(false);
  });

  it('rejects overly long text (max_length)', () => {
    const r = validateIntakeAnswers([{ key: 'note', label: 'Note', type: 'text', max_length: 5 }], { note: '123456' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-boolean for boolean field', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'male', has_allergies: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('rejects invalid date format', () => {
    const r = validateIntakeAnswers(fields, { full_name: 'Adam', age: 30, gender: 'male', birth_date: '03-09-2026' });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object answers payload', () => {
    const r = validateIntakeAnswers(fields, 'nope');
    expect(r.ok).toBe(false);
  });
});

describe('PHASE 4 — submitIntakeResponse (portal, identity-derived)', () => {
  beforeEach(() => {
    state.singleForm = true; // getActiveForm path
    state.insertResponse = true;
  });

  it('submits valid answers and records e-consent', async () => {
    const out = await submitIntakeResponse({
      identity,
      formId: 'f1',
      answers: { full_name: 'Adam', age: 30, gender: 'male', symptoms: ['pain'] },
      consent: true,
    });
    expect(out.response.id).toBe('r1');
    expect(out.consentSigned).toBe(true);
  });

  it('rejects answers that fail server-side validation', async () => {
    await expect(
      submitIntakeResponse({ identity, formId: 'f1', answers: { full_name: 'Adam', gender: 'male' } })
    ).rejects.toThrow('INTAKE_VALIDATION_FAILED');
  });

  it('form-not-found / not-active-for-tenant', async () => {
    state.formError = { message: 'not found' };
    await expect(
      submitIntakeResponse({ identity, formId: 'f1', answers: { full_name: 'A', age: 1, gender: 'male' } })
    ).rejects.toThrow('INTAKE_FORM_NOT_FOUND');
  });

  it('rejects an appointment link that does not belong to the patient', async () => {
    state.appointment = { data: null, error: null };
    await expect(
      submitIntakeResponse({
        identity,
        formId: 'f1',
        answers: { full_name: 'Adam', age: 30, gender: 'male' },
        appointmentId: 'aX',
      })
    ).rejects.toThrow('APPOINTMENT_NOT_FOUND_FOR_PATIENT');
  });

  it('does not require consent when the form has no consent_text', async () => {
    state.form = { ...makeForm(), consent_text: null };
    const out = await submitIntakeResponse({
      identity,
      formId: 'f1',
      answers: { full_name: 'Adam', age: 30, gender: 'male' },
      consent: false,
    });
    expect(out.consentSigned).toBe(false);
  });
});