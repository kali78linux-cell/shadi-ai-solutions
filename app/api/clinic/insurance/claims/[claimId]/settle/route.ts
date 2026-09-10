import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { settleClaim } from '@/lib/services/insurance';

// submitted → settled. Records `claim_settled` ledger event — explicitly NOT
// a cash movement and NEVER creates a payment (D-I2). Actual money arrives
// via the existing payments API (payment_recorded).
export async function POST(req: Request, { params }: { params: Promise<{ claimId: string }> }) {
  try {
    const { claimId } = await params;
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    if (body?.settled_amount === undefined) return NextResponse.json({ error: 'settled_amount required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await settleClaim({
      clinicId: body.clinic_id,
      claimId,
      settledAmount: Number(body.settled_amount),
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /INVALID_CLAIM_STATUS|CLAIM_NOT_FOUND|INVALID_SETTLED_AMOUNT|SETTLED_EXCEEDS_CLAIM/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
