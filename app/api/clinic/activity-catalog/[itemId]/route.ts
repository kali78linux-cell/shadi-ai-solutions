import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';

/**
 * DHS-OPS — activity catalog item admin (PUT/DELETE).
 * GENUINELY activity-specific update schemas (imaging vs lab).
 */
export const runtime = 'nodejs';

const TABLE_ALLOWLIST = ['imaging_services', 'lab_services'] as const;
type CatalogTable = (typeof TABLE_ALLOWLIST)[number];

const imagingSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  modality: z.string().max(100).nullable().optional(),
  duration_minutes: z.number().int().positive().nullable().optional(),
  price: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});

const labSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  turnaround_hours: z.number().int().positive().nullable().optional(),
  price: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
});

function parseFor(table: CatalogTable, body: unknown) {
  return table === 'imaging_services' ? imagingSchema.safeParse(body) : labSchema.safeParse(body);
}

const SELECT_COLS: Record<CatalogTable, string> = {
  imaging_services: 'id, name, description, modality, duration_minutes, price, active',
  lab_services: 'id, name, description, turnaround_hours, price, active',
};

export async function PUT(req: Request, { params }: { params: { itemId: string } }) {
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

    const { data, error } = await supabaseAdmin
      .from(t)
      .update(parsed.data)
      .eq('id', params.itemId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .select(SELECT_COLS[t])
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'العنصر غير موجود' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    logEvent('activity_catalog_put_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { itemId: string } }) {
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

    const { data, error } = await supabaseAdmin
      .from(t)
      .update({ deleted_at: new Date().toISOString(), active: false })
      .eq('id', params.itemId)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .select('id, name')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'العنصر غير موجود' }, { status: 404 });
    logEvent('activity_catalog_deleted', { clinic_id: clinicId, table, item_id: params.itemId });
    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    logEvent('activity_catalog_delete_error', { error: err instanceof Error ? err.message : String(err) }, 'error');
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
