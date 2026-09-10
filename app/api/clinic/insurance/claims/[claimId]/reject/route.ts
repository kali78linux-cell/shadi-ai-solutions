import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { rejectClaim } from '@/lib/services/insurance';

// draft|submitted → rejected (reason required; no ledger event — audit only).
export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const { claimId } = await params;
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (!body?.reason) return NextResponse.json({ error: 'reason required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await rejectClaim({
      clinicId: body.clinic_id,
      claimId,
      reason: body.reason,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVALID_CLAIM_STATUS|CLAIM_NOT_FOUND|REJECTION_REASON_REQUIRED/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
