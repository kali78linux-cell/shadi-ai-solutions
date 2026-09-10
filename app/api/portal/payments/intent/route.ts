import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizePatientRequest } from '@/lib/services/patientPortal';
import {
  createOrReusePortalIntent,
  PortalPaymentError,
} from '@/lib/services/portalPayments';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ invoice_id: z.string().uuid() });

/**
 * POST /api/portal/payments/intent — create or reuse a payment intent for ONE
 * of the authenticated patient's own payable invoices (command §4).
 *
 * Security (all server-side): identity-derived clinic/patient (client ids
 * ignored), server-derived amount (invoice balance) and currency (invoice
 * snapshot → settings fallback), server-resolved Connect destination.
 * Response exposes ONLY: client_secret / payment_intent_id / status / amount /
 * currency — nothing else.
 */
export async function POST(req: Request) {
  const auth = await authorizePatientRequest(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error.code }, { status: auth.error.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 });
  }

  try {
    const result = await createOrReusePortalIntent(auth.identity, parsed.data.invoice_id);
    return NextResponse.json({
      client_secret: result.client_secret,
      payment_intent_id: result.payment_intent_id,
      status: result.status,
      amount: result.amount,
      currency: result.currency,
    });
  } catch (err) {
    if (err instanceof PortalPaymentError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: 'PORTAL_PAYMENT_INTENT_FAILED' }, { status: 500 });
  }
}