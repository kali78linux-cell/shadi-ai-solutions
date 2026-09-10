import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { getAgingSummary } from '@/lib/services/accounting';

// Accounting Phase B — receivable aging (D-B5). Derived, read-only.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const data = await getAgingSummary(clinicId, url.searchParams.get('patient_id'));
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}