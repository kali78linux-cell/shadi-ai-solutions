import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { uploadMessageFile } from '@/lib/services/clinicMessaging';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id مطلوب' }, { status: 400 });
    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'غير مخول' }, { status: auth.status });
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'الملف مطلوب (file)' }, { status: 400 });
    const result = await uploadMessageFile(clinicId, file);
    if ('message' in result) return NextResponse.json({ error: result.message }, { status: 400 });
    return NextResponse.json({ data: { file_url: result.url, file_name: result.name, file_size: result.size } }, { status: 201 });
  } catch (err) {
    logEvent('messaging_upload_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
