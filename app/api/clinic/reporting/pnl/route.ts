import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { getProfitAndLoss } from '@/lib/services/reporting';

// P&L report (D-R1) — derived read-only. FINANCE_READ only (D-P3/D-R3);
// claim kinds are structurally excluded by the view.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await getProfitAndLoss(clinicId, {
      fromMonth: url.searchParams.get('from_month') ?? undefined,
      toMonth: url.searchParams.get('to_month') ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVALID_/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
