import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, CASH_SESSION_CLOSE_ROLES } from '@/lib/services/clinicAuthorization';
import { closeCashSession } from '@/lib/services/accounting';

// Accounting Phase C — close a cash register session (FINANCE_ADMIN only).
// The RPC computes expected cash from EXPLICIT ledger kinds (never direction
// alone) and stores counted/variance as a snapshot. Variance is never booked
// to the ledger (pending documented design decision).
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, CASH_SESSION_CLOSE_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const body = await req.json();
    const data = await closeCashSession({
      clinicId,
      sessionId,
      countedAmount: body?.counted_amount,
      notes: body?.notes ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /CASH_COUNTED_INVALID|CASH_SESSION_CLOSE_SNAPSHOT_INCOMPLETE|CASH_SESSION_CLOSED_IS_TERMINAL/.test(message)
      ? 400
      : /CASH_SESSION_NOT_FOUND/.test(message)
        ? 404
        : /CASH_SESSION_ALREADY_CLOSED/.test(message)
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
