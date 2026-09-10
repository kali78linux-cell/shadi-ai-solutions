import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { getAgingPayer } from '@/lib/services/reporting';

// Aging payer enrichment (additive over receivable_aging) — the aging logic
// itself is reused as-is from Phase B (buckets / exclusions untouched).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const payerType = url.searchParams.get('payer_type');
    const data = await getAgingPayer(clinicId, {
      payerType: payerType === 'patient' || payerType === 'insurance' || payerType === 'employer' || payerType === 'third_party'
        ? payerType
        : undefined,
      bucket: url.searchParams.get('bucket') ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
