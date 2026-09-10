import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';

/**
 * IMAGING RESULT — the completed study (images) + report finalized by the
 * imaging center and delivered ONLY to the referring organization.
 *
 * POST → imaging center finalizes the result for an imaging request it owns.
 * GET  → the imaging center OR the referring clinic may read the result.
 */
export const runtime = 'nodejs';

const postSchema = z.object({
  report_text: z.string().max(20000).nullable().optional(),
  report_file_id: z.string().uuid().nullable().optional(),
  image_ids: z.array(z.string().uuid()).max(50).optional(),
});

export async function POST(req: Request, { params }: { params: { requestId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية توثيق النتائج' }, { status: 403 });

    const { data: request } = await supabaseAdmin
      .from('imaging_requests')
      .select('id, clinic_id, referring_clinic_id, patient_id, status')
      .eq('id', params.requestId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: 'طلب التصوير غير موجود' }, { status: 404 });
    if (request.clinic_id !== clinicId) {
      return NextResponse.json({ error: 'لا تملك صلاحية توثيق هذا الطلب' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    if (!parsed.data.report_text && !parsed.data.report_file_id && (!parsed.data.image_ids || parsed.data.image_ids.length === 0)) {
      return NextResponse.json({ error: 'أضف تقريرًا أو صورًا أو كليهما' }, { status: 400 });
    }

    const now = new Date();
    const { data: result, error: insError } = await supabaseAdmin
      .from('imaging_results')
      .insert({
        imaging_request_id: request.id,
        imaging_center_id: clinicId,
        patient_id: request.patient_id,
        referring_clinic_id: request.referring_clinic_id,
        status: 'finalized',
        report_text: parsed.data.report_text ?? null,
        report_file_id: parsed.data.report_file_id ?? null,
        images: parsed.data.image_ids ?? [],
        finalized_by: auth.user?.id ?? null,
        finalized_at: now.toISOString(),
      })
      .select('*')
      .single();
    if (insError) throw new Error(insError.message);

    const { error: updError } = await supabaseAdmin
      .from('imaging_requests')
      .update({ status: 'completed', completed_at: now.toISOString() })
      .eq('id', request.id);
    if (updError) throw new Error(updError.message);

    logEvent('imaging_result_finalized', {
      imaging_center_id: clinicId,
      referring_clinic_id: request.referring_clinic_id,
      request_id: request.id,
      patient_id: request.patient_id,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    logEvent('imaging_result_post_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: { params: { requestId: string } }) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: request } = await supabaseAdmin
      .from('imaging_requests')
      .select('id, clinic_id, referring_clinic_id')
      .eq('id', params.requestId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!request) return NextResponse.json({ error: 'طلب التصوير غير موجود' }, { status: 404 });
    if (request.clinic_id !== clinicId && request.referring_clinic_id !== clinicId) {
      return NextResponse.json({ error: 'لا تملك صلاحية الاطلاع على هذه النتيجة' }, { status: 403 });
    }

    const { data: result, error } = await supabaseAdmin
      .from('imaging_results')
      .select('*')
      .eq('imaging_request_id', params.requestId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: result ?? null });
  } catch (err) {
    logEvent('imaging_result_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}