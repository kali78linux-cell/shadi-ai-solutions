import { NextResponse } from 'next/server';
import {
  authorizeClinicRequest,
  roleDenied,
  FINANCE_ADMIN_ROLES,
} from '@/lib/services/clinicAuthorization';
import { countryToCode } from '@/lib/clinic/localization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import {
  getConnectReadinessView,
  startConnectOnboarding,
  PortalPaymentError,
} from '@/lib/services/portalPayments';

export const dynamic = 'force-dynamic';

/**
 * GET /api/clinic/payments/connect?clinic_id=…
 * Connect readiness (owner/accountant only): mirrored state + sync-on-read.
 * No ledger writes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
  const authorization = await authorizeClinicRequest(req, clinicId);
  const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
  if (denied) return NextResponse.json({ error: 'FORBIDDEN' }, { status: denied.status });
  try {
    return NextResponse.json(await getConnectReadinessView(clinicId));
  } catch (err) {
    if (err instanceof PortalPaymentError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: 'CONNECT_READINESS_FAILED' }, { status: 500 });
  }
}

/**
 * POST /api/clinic/payments/connect?clinic_id=…
 * Starts (or resumes) Stripe-hosted Connect onboarding for THIS clinic.
 * - country is SERVER-DERIVED from the clinic profile (never client-supplied).
 * - refresh/return URLs are SERVER-BUILT same-origin (no open redirect).
 * - Stripe rejects unsupported countries as-is (owner amendment #3: no
 *   workarounds; availability stays an External Production Gate).
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get('clinic_id');
  if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
  const authorization = await authorizeClinicRequest(req, clinicId);
  const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
  if (denied) return NextResponse.json({ error: 'FORBIDDEN' }, { status: denied.status });

  // Server-derived country from the clinic profile.
  const { data: clinic } = await supabaseAdmin
    .from('clinics')
    .select('settings')
    .eq('id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  const country = countryToCode(
    ((clinic?.settings ?? {}) as Record<string, unknown>)?.country as string | null
  );
  if (!country) {
    return NextResponse.json({ error: 'PROVIDER_COUNTRY_REQUIRED' }, { status: 400 });
  }

  // Server-built same-origin URLs.
  const origin = url.origin;
  const refreshUrl = `${origin}/dashboard/settings/payments?connect=refresh`;
  const returnUrl = `${origin}/dashboard/settings/payments?connect=return`;

  try {
    const result = await startConnectOnboarding({
      clinicId,
      country,
      refreshUrl,
      returnUrl,
    });
    logEvent('portal_connect_onboarding_link_created', { clinic_id: clinicId, country });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PortalPaymentError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    // Provider-side rejections (e.g. unsupported country) surface transparently.
    const message = err instanceof Error ? err.message : String(err);
    logEvent('portal_connect_onboarding_failed', { clinic_id: clinicId, error: message }, 'error');
    return NextResponse.json({ error: 'CONNECT_ONBOARDING_FAILED' }, { status: 502 });
  }
}