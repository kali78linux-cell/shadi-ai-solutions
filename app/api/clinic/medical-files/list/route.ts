import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';

/**
 * MEDICAL FILES — clinic-wide listing for the imaging center dashboard.
 * GET /api/clinic/medical-files/list?clinic_id=…
 * Returns every non-deleted file recorded by THIS org (tenant-scoped), newest
 * first. Optional ?patient_id narrows to one patient.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const patientId = url.searchParams.get('patient_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    let query = supabaseAdmin
      .from('medical_files')
      .select('*')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (patientId) query = query.eq('patient_id', patientId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logEvent('medical_files_list_all_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}