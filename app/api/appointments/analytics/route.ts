import { NextResponse } from 'next/server';
import { getAppointmentAnalytics } from '@/lib/services/appointmentAnalytics';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    const data = await getAppointmentAnalytics(clinicId, url.searchParams.get('from') ?? undefined, url.searchParams.get('to') ?? undefined);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
