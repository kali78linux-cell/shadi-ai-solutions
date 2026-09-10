import { NextResponse } from 'next/server';
import { getOperationsAnalytics } from '@/lib/services/operationsAnalytics';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';

// STEP: Operations Intelligence — Foundation
// Read-only, tenant-scoped analytics. Same authorization posture as the rest
// of the dashboard APIs: real bearer token + clinic membership.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status },
      );
    }
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;
    const data = await getOperationsAnalytics(clinicId, from, to);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
