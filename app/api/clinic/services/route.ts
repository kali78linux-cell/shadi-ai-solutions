import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  duration_minutes: z.coerce.number().int().min(5).max(480),
  price: z.coerce.number().min(0).optional().nullable(),
  active: z.boolean().optional().default(true),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('clinic_services')
      .select('id, name, description, duration_minutes, price, active, deleted_at')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ data: (data || []).map((s) => ({ ...s, active: s.active && !s.deleted_at })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = serviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid service payload', details: parsed.error.errors }, { status: 400 });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('clinic_services')
      .insert({
        clinic_id: clinicId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        duration_minutes: parsed.data.duration_minutes,
        price: parsed.data.price ?? null,
        active: parsed.data.active,
        deleted_at: null,
      })
      .select('id, name, description, duration_minutes, price, active, deleted_at')
      .single();

    if (error) throw new Error(error.message);

    logEvent('clinic_service_created', { clinic_id: clinicId, service_id: data.id });
    return NextResponse.json({ data: { ...data, active: data.active && !data.deleted_at } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_post_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}