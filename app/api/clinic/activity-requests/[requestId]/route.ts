import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { applyWorkflowTransition, workflowErrorResponse } from '@/lib/services/workflowService';
import { issueInvoiceForImagingRequest } from '@/lib/services/imagingBilling';
import { logEvent } from '@/lib/server/logging';

/**
 * DHS-OPS + PHASE 1B — activity request/case admin.
 * PATCH status is now WORKFLOW-DIRECTED: every transition runs through
 * lib/services/workflowService.ts (machine validation + activity ownership +
 * atomic guarded update + immutable workflow_audit). No free-form status.
 * notes-only updates stay a plain PATCH. DELETE soft-deletes (unchanged).
 */
export const runtime = 'nodejs';

const TABLE_ALLOWLIST = ['imaging_requests', 'lab_cases'] as const;
type RequestTable = (typeof TABLE_ALLOWLIST)[number];

const updateSchema = z
  .object({
    status: z.string().min(1).max(50).optional(),
    notes: z.string().max(2000).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.notes !== undefined, { message: 'Nothing to update' });

const SELECT_COLS = 'id, requested_service, case_ref, patient_ref, status, notes';

export async function PATCH(req: Request, { params }: { params: { requestId: string } }) {
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
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });

    let fromStatus: string | null = null;
    let toStatus: string | null = null;

    if (parsed.data.status !== undefined) {
      // PHASE 1B — workflow-directed transition (validate → apply → audit, atomic).
      try {
        const result = await applyWorkflowTransition({
          clinicId,
          entityType: t,
          entityId: params.requestId,
          toStatus: parsed.data.status,
          actorUserId: auth.user?.id ?? null,
          actorRole: auth.role ?? null,
          reason: parsed.data.reason ?? null,
        });
        fromStatus = result.fromStatus;
        toStatus = result.toStatus;

        // IMAGING → BILLING (root-cause fix): a COMPLETED imaging request with a
        // linked billable service issues the invoice exactly once. Accounting is
        // driven by "imaging performed", never by the appointment's existence.
        if (t === 'imaging_requests' && toStatus === 'completed') {
          await issueInvoiceForImagingRequest({ clinicId, requestId: params.requestId, actorUserId: auth.user?.id ?? null });
        }
      } catch (err) {
        const wfRes = workflowErrorResponse(err);
        if (wfRes) return wfRes;
        throw err;
      }
    }

    // notes-only / follow-up notes update (not a status change — no audit row).
    if (parsed.data.notes !== undefined) {
      const { error: notesError } = await supabaseAdmin
        .from(t)
        .update({ notes: parsed.data.notes })
        .eq('id', params.requestId)
        .eq('clinic_id', clinicId)
        .is('deleted_at', null);
      if (notesError) throw new Error(notesError.message);
    }

    const { data, error } = await supabaseAdmin
      .from(t)
      .select(SELECT_COLS)
      .eq('id', params.requestId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    return NextResponse.json({ data, transition: fromStatus ? { from: fromStatus, to: toStatus } : undefined });
  } catch (err) {
    logEvent('activity_requests_patch_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { requestId: string } }) {
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

    const { data, error } = await supabaseAdmin
      .from(t)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', params.requestId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .select('id, status')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 });
    logEvent('activity_requests_deleted', { clinic_id: clinicId, table, request_id: params.requestId });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('activity_requests_delete_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
