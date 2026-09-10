import { NextResponse } from 'next/server';
import {
  authorizeClinicRequest,
  roleDenied,
  FINANCE_ADMIN_ROLES,
} from '@/lib/services/clinicAuthorization';
import {
  initiateProviderRefund,
  PortalRefundError,
} from '@/lib/services/portalRefunds';

export const dynamic = 'force-dynamic';

/**
 * POST /api/clinic/payments/refund?clinic_id=…
 * Admin/FINANCE-only provider refund initiation (patients can NEVER self-refund).
 *
 * All inputs that matter are SERVER-DERIVED:
 *  - clinic_id  → from authorization (query param must match membership)
 *  - patient_id / invoice_id / currency → from the payment + invoice rows
 *  - amount     → validated against the server-derived refundable cap
 *
 * Optional `idempotency_key` (UUID): Stripe-style retry token. A retried
 * logical request (same key + same original payment) returns the ORIGINAL
 * refund — never a second provider refund (level-1 idempotency, DB-enforced).
 *
 * The accounting reversal is NOT written here — it happens on the webhook
 * (`refund.updated` = succeeded → existing refund_payment RPC).
 */
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) {
      return NextResponse.json(
        { error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: denied.status }
      );
    }

    const body = await req.json().catch(() => ({}));
    const result = await initiateProviderRefund({
      clinicId,
      paymentId: String(body?.payment_id ?? ''),
      amount: Number(body?.amount),
      reason: String(body?.reason ?? ''),
      actorUserId: authorization.user?.id ?? null,
      idempotencyKey: body?.idempotency_key != null ? String(body.idempotency_key) : undefined,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof PortalRefundError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: 'REFUND_INIT_FAILED', detail: message }, { status: 500 });
  }
}