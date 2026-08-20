import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const serviceUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  duration_minutes: z.coerce.number().int().min(5).max(480).optional(),
  price: z.coerce.number().min(0).optional().nullable(),
  active: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const serviceId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!serviceId) return NextResponse.json({ error: 'service_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = serviceUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid service payload', details: parsed.error.errors }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    if (parsed.data.duration_minutes !== undefined) update.duration_minutes = parsed.data.duration_minutes;
    if (parsed.data.price !== undefined) update.price = parsed.data.price;
    if (parsed.data.active !== undefined) update.active = parsed.data.active;

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('clinic_services')
      .update(update)
      .eq('id', serviceId)
      .eq('clinic_id', clinicId)
      .select('id, name, description, duration_minutes, price, active, deleted_at')
      .single();

    if (error) throw new Error(error.message);

    logEvent('clinic_service_updated', { clinic_id: clinicId, service_id: serviceId });
    return NextResponse.json({ data: { ...data, active: data.active && !data.deleted_at } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const serviceId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!serviceId) return NextResponse.json({ error: 'service_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { error } = await supabase
      .from('clinic_services')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', serviceId)
      .eq('clinic_id', clinicId);

    if (error) throw new Error(error.message);

    logEvent('clinic_service_deleted', { clinic_id: clinicId, service_id: serviceId });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_delete_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}