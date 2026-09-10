import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { listRecalls, computeEligibleRecalls, getRecallRules } from '@/lib/services/recallService';
import { logEvent } from '@/lib/server/logging';

/**
 * PHASE 3 — Recall management (staff, tenant-scoped).
 * GET: recall assignments + eligible patients preview + rules.
 */
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const status = url.searchParams.get('status') ?? undefined;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rules = await getRecallRules(clinicId);
    const assignments = await listRecalls(clinicId, status);
    const eligible = rules?.enabled
      ? await computeEligibleRecalls({ clinicId, intervalDays: rules.interval_days, limit: 50 })
      : [];

    return NextResponse.json({ data: { rules, assignments, eligible } });
  } catch (err) {
    logEvent('recall_list_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}