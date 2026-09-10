import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { getGrowthIntelligence } from '@/lib/services/growthIntelligence';

/**
 * PP-7 — Growth / Retention & Engagement (clinic-facing, read-only, DATA_ROLES).
 * GET /api/clinic/growth-intelligence?clinic_id=…&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * All outputs are DERIVED at read time from the existing clinic tables
 * (patients · appointments · conversations · clinic_recalls ·
 * clinic_waitlist_entries). No writes, no migrations, no autonomous actions.
 * clinic_id is always the authorized tenant (never client-derived scope).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, DATA_ROLES);
    if (denied) {
      return NextResponse.json(
        { error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: denied.status }
      );
    }

    const data = await getGrowthIntelligence(clinicId, {
      fromDate: url.searchParams.get('from_date') ?? undefined,
      toDate: url.searchParams.get('to_date') ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /^INVALID_/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
