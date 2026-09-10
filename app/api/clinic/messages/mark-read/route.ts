import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { markConversationRead } from '@/lib/services/clinicMessaging';

export const runtime = 'nodejs';

export async function PUT(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const partnerId = url.searchParams.get('partner_id') ?? '';
    if (!clinicId || !partnerId) {
      return NextResponse.json({ error: 'clinic_id و partner_id مطلوبان' }, { status: 400 });
    }
    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'غير مخول' }, { status: auth.status });
    await markConversationRead(clinicId, partnerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    logEvent('messaging_markread_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}