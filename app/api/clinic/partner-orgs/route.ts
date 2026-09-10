import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { listPartnerOrgsWithStatus } from '@/lib/services/organizationRelationships';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE F — partner discovery for the referral-relationship UI.
 * GET /api/clinic/partner-orgs?clinic_id=<uuid>&activity=imaging_center|clinic|dental_lab
 * Returns partner orgs of the requested activity (excluding the caller), each
 * annotated with the caller's latest relationship status so the UI can render
 * "إرسال طلب ارتباط" vs the current state (waiting/accepted/rejected/suspended).
 */
export const runtime = 'nodejs';

const ACTIVITIES = ['imaging_center', 'clinic', 'dental_lab'] as const;
type Activity = (typeof ACTIVITIES)[number];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const activity = (url.searchParams.get('activity') ?? 'imaging_center') as Activity;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!ACTIVITIES.includes(activity)) {
      return NextResponse.json({ error: 'نشاط غير مدعوم' }, { status: 400 });
    }

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const partners = await listPartnerOrgsWithStatus(clinicId, activity);
    return NextResponse.json({ data: partners });
  } catch (err) {
    logEvent('partner_orgs_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
