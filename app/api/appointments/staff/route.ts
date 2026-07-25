import { NextResponse } from 'next/server';
import { listAppointments } from '@/lib/services/appointmentEngine';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';

const STATUS_BY_VIEW: Record<string, string | undefined> = {
  pending: 'tentative',
  today: undefined,
  upcoming: 'confirmed',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    const view = url.searchParams.get('view') ?? 'today';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const data = await listAppointments({
      clinicId,
      view: view === 'today' ? 'day' : view === 'upcoming' ? undefined : undefined,
      date: view === 'today' ? today : undefined,
      status: STATUS_BY_VIEW[view],
      from: view === 'upcoming' ? tomorrow : undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
