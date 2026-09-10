import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { canTransitionRelationship, listRelationshipsForTenant, type RelationshipStatus } from '@/lib/services/organizationRelationships';
import { logEvent } from '@/lib/server/logging';

/**
 * Organization relationships (independent orgs, many-to-many).
 * GET → relationships where this tenant is source OR target.
 * POST → request a relationship toward another organization.
 * PATCH → accept/reject/suspend an existing relationship (state machine).
 */
export const runtime = 'nodejs';

const createSchema = z.object({
  target_org_id: z.string().uuid(),
  relationship_type: z.enum(['referral_partner', 'imaging_provider', 'lab_provider']),
});

const patchSchema = z.object({
  relationship_id: z.string().uuid(),
  status: z.enum(['accepted', 'rejected', 'suspended', 'canceled']),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

    // PHASE F — enriched rows (org names/slugs + direction relative to caller)
    // so both dashboards render partner names without N+1 client lookups.
    const enriched = await listRelationshipsForTenant(clinicId);
    return NextResponse.json({ data: enriched });
  } catch (err) {
    logEvent('org_relationships_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية إدارة الشركاء' }, { status: 403 });

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });
    if (parsed.data.target_org_id === clinicId) {
      return NextResponse.json({ error: 'لا يمكن إنشاء علاقة مع نفس المؤسسة' }, { status: 400 });
    }

    // PHASE F — duplicate guard: an ACTIVE (requested/accepted/suspended)
    // relationship between the two orgs in EITHER direction blocks a new
    // request (rejected/canceled rows do not — re-requesting is allowed).
    const { data: activeBetween } = await supabaseAdmin
      .from('organization_relationships')
      .select('id, status, source_org_id, target_org_id')
      .or(
        `and(source_org_id.eq.${clinicId},target_org_id.eq.${parsed.data.target_org_id}),and(source_org_id.eq.${parsed.data.target_org_id},target_org_id.eq.${clinicId})`
      )
      .in('status', ['requested', 'accepted', 'suspended'])
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (activeBetween) {
      return NextResponse.json(
        { error: 'توجد علاقة نشطة أو طلب قائم مع هذه الجهة بالفعل', status: activeBetween.status },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('organization_relationships')
      .insert({
        source_org_id: clinicId,
        target_org_id: parsed.data.target_org_id,
        relationship_type: parsed.data.relationship_type,
        status: 'requested',
        created_by: auth.user?.id ?? null,
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    logEvent('org_relationship_requested', { clinic_id: clinicId, target_org_id: parsed.data.target_org_id, relationship_type: parsed.data.relationship_type });
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    logEvent('org_relationships_post_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, ADMIN_ROLES);
    if (gate) return NextResponse.json({ error: 'لا تملك صلاحية إدارة الشركاء' }, { status: 403 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'بيانات غير صحيحة', details: parsed.error.errors }, { status: 400 });

    const status = parsed.data.status === 'canceled' ? 'rejected' : parsed.data.status;

    const { data: row, error: readError } = await supabaseAdmin
      .from('organization_relationships')
      .select('id, source_org_id, target_org_id, status')
      .eq('id', parsed.data.relationship_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return NextResponse.json({ error: 'العلاقة غير موجودة' }, { status: 404 });

    // Only a party of the relationship may manage it.
    if (row.source_org_id !== clinicId && row.target_org_id !== clinicId) {
      return NextResponse.json({ error: 'لا تملك صلاحية على هذه العلاقة' }, { status: 403 });
    }
    // PHASE F — pure, unit-tested transition rules. `party` is the caller's
    // side; requested→accepted stays TARGET-only, suspended→accepted (reactivate)
    // is allowed for either party, rejected/canceled are terminal.
    const party = row.source_org_id === clinicId ? 'source' : row.target_org_id === clinicId ? 'target' : 'neither';
    const fromStatus = row.status as RelationshipStatus;
    if (!canTransitionRelationship(fromStatus, status as RelationshipStatus, party)) {
      return NextResponse.json(
        { error: `انتقال غير مسموح: ${fromStatus} → ${status}` },
        { status: 409 }
      );
    }

    const patch: Record<string, unknown> = { status };
    if (status === 'accepted') patch.accepted_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('organization_relationships')
      .update(patch)
      .eq('id', parsed.data.relationship_id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    logEvent('org_relationship_updated', { clinic_id: clinicId, relationship_id: parsed.data.relationship_id, status });
    return NextResponse.json({ data });
  } catch (err) {
    logEvent('org_relationships_patch_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
