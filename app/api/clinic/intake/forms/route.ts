import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { createIntakeForm, listIntakeForms } from '@/lib/services/intakeService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 4 — Intake forms (staff, tenant-scoped).
 * GET: list forms (DATA_ROLES) · POST: create form (ADMIN_ROLES).
 * The form_schema is validated server-side before persisting.
 */
export const runtime = 'nodejs';

const fieldSchema = z.object({
  key: z.string().min(1).max(60).regex(/^[a-zA-Z0-9_]+$/),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'multi_select']),
  required: z.boolean().optional(),
  options: z.array(z.string().max(120)).max(30).optional(),
  max_length: z.number().int().min(1).max(5000).optional(),
}).transform((f) => ({
  key: f.key,
  label: f.label,
  type: f.type,
  required: f.required,
  options: f.options,
  max_length: f.max_length,
}));

const createSchema = z.object({
  clinic_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  schema: z.array(fieldSchema).min(1).max(50),
  consent_text: z.string().max(5000).optional().nullable(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const forms = await listIntakeForms(clinicId);
    return NextResponse.json({ data: forms });
  } catch (err) {
    logEvent('intake_forms_list_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.errors }, { status: 400 });
    }
    const { clinic_id } = parsed.data;
    const auth = await authorizeClinicRequest(req, clinic_id);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية الإدارة' }, { status: 403 });

    const form = await createIntakeForm({
      clinicId: clinic_id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      schema: parsed.data.schema,
      consentText: parsed.data.consent_text ?? null,
    });
    return NextResponse.json({ data: form }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('intake_form_create_error', { error: message }, 'error');
    if (message === 'INVALID_FORM_SCHEMA') {
      return NextResponse.json({ error: 'Invalid form schema' }, { status: 400 });
    }
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}