import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { withActivityEntitlement, activityEntitlementErrorResponse, type ActivityCapabilityKey } from '@/lib/subscription/activityEntitlements';
import { logEvent } from '@/lib/server/logging';

/**
 * DHS-OPS — activity requests (imaging_requests / lab_cases).
 * GENUINELY activity-specific creation schemas:
 *   imaging: patient_ref + requested_service  (patient-facing imaging request)
 *   lab:     case_ref + referring_clinic + requested_service (clinic→lab work request)
 * GET: any member (DATA_ROLES) · POST: owner/manager (ADMIN_ROLES).
 * PHASE 1A — POST creation is gated by the activity-specific entitlement
 * (imaging_requests_limit / lab_cases_limit) AFTER authorization, fail-closed.
 */
export const runtime = 'nodejs';

const TABLE_ALLOWLIST = ['imaging_requests', 'lab_cases'] as const;
type RequestTable = (typeof TABLE_ALLOWLIST)[number];

/** PHASE 1A — creation capability per request table. */
const CAPABILITY_BY_TABLE: Record<RequestTable, ActivityCapabilityKey> = {
  imaging_requests: 'imaging_requests_limit',
  lab_cases: 'lab_cases_limit',
};

const imagingSchema = z.object({
  patient_ref: z.string().min(1).max(200),
  requested_service: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const labSchema = z.object({
  case_ref: z.string().min(1).max(200),
  referring_clinic: z.string().max(200).nullable().optional(),
  requested_service: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

function parseFor(table: RequestTable, body: unknown) {
  return table === 'imaging_requests' ? imagingSchema.safeParse(body) : labSchema.safeParse(body);
}

const SELECT_COLS: Record<RequestTable, string> = {
  imaging_requests: 'id, patient_ref, requested_service, status, notes, created_at',
  lab_cases: 'id, case_ref, referring_clinic, requested_service, status, notes, created_at',
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const table = url.searchParams.get('table') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!TABLE_ALLOWLIST.includes(table as RequestTable)) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    const t = table as RequestTable;

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from(t)
      .select(SELECT_COLS[t])
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logEvent('activity_requests_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const table = url.searchParams.get('table') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!TABLE_ALLOWLIST.includes(table as RequestTable)) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    const t = table as RequestTable;

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية إدارة النشاط' }, { status: 403 });

    const body = await req.json();
    const parsed = parseFor(t, body);
    if (!parsed.success) return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });

    try {
      const data = await withActivityEntitlement(clinicId, CAPABILITY_BY_TABLE[t], async () => {
        const { data, error } = await supabaseAdmin
          .from(t)
          .insert({ clinic_id: clinicId, ...parsed.data })
          .select(SELECT_COLS[t])
          .single();
        if (error) throw new Error(error.message);
        return data;
      });
      return NextResponse.json({ data }, { status: 201 });
    } catch (err) {
      const entRes = activityEntitlementErrorResponse(err);
      if (entRes) return entRes;
      throw err;
    }
  } catch (err) {
    logEvent('activity_requests_post_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
