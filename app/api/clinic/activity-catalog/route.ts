import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { withActivityEntitlement, activityEntitlementErrorResponse, type ActivityCapabilityKey } from '@/lib/subscription/activityEntitlements';
import { logEvent } from '@/lib/server/logging';

/**
 * DHS-OPS — activity domain catalog (imaging_services / lab_services).
 * GENUINELY activity-specific schemas: imaging uses modality+duration;
 * lab uses turnaround_hours. NOT one generic template.
 * GET: any member (DATA_ROLES). POST/PUT: owner/manager (ADMIN_ROLES).
 * PHASE 1A — POST creation is gated by the activity-specific entitlement
 * (imaging_services_limit / lab_services_limit) AFTER authorization, fail-closed.
 */
export const runtime = 'nodejs';

const TABLE_ALLOWLIST = ['imaging_services', 'lab_services'] as const;
type CatalogTable = (typeof TABLE_ALLOWLIST)[number];

/** PHASE 1A — creation capability per catalog table. */
const CAPABILITY_BY_TABLE: Record<CatalogTable, ActivityCapabilityKey> = {
  imaging_services: 'imaging_services_limit',
  lab_services: 'lab_services_limit',
};

const imagingSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  modality: z.string().max(100).nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  price: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional().default(true),
});

const labSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  turnaround_hours: z.number().int().positive().nullable().optional(),
  price: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional().default(true),
});

function parseFor(table: CatalogTable, body: unknown) {
  return table === 'imaging_services' ? imagingSchema.safeParse(body) : labSchema.safeParse(body);
}

const SELECT_COLS: Record<CatalogTable, string> = {
  imaging_services: 'id, name, description, modality, duration_minutes, price, active',
  lab_services: 'id, name, description, turnaround_hours, price, active',
};

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const table = url.searchParams.get('table') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!TABLE_ALLOWLIST.includes(table as CatalogTable)) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    const t = table as CatalogTable;

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    const gate = roleDenied(auth, DATA_ROLES);
    if (gate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from(t)
      .select(SELECT_COLS[t])
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    logEvent('activity_catalog_get_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';
    const table = url.searchParams.get('table') ?? '';
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!TABLE_ALLOWLIST.includes(table as CatalogTable)) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    const t = table as CatalogTable;

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
    logEvent('activity_catalog_post_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
