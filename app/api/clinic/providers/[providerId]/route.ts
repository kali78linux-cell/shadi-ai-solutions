import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const providerUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  title: z.string().max(200).optional().nullable(),
  provider_type: z.enum(['dentist', 'hygienist', 'staff']).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  active: z.boolean().optional(),
});

export async function PUT(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const providerId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!providerId) return NextResponse.json({ error: 'provider_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = providerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid provider payload', details: parsed.error.errors }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.provider_type !== undefined) update.provider_type = parsed.data.provider_type;
    if (parsed.data.email !== undefined) update.email = parsed.data.email;
    if (parsed.data.phone !== undefined) update.phone = parsed.data.phone;
    if (parsed.data.active !== undefined) update.deleted_at = parsed.data.active ? null : new Date().toISOString();

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('providers')
      .update(update)
      .eq('id', providerId)
      .eq('clinic_id', clinicId)
      .select('id, name, title, provider_type, email, phone, deleted_at')
      .single();

    if (error) throw new Error(error.message);

    logEvent('clinic_provider_updated', { clinic_id: clinicId, provider_id: providerId });
    return NextResponse.json({ data: { ...data, active: !data.deleted_at } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_providers_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { pathname, searchParams } = new URL(req.url);
    const providerId = pathname.split('/').filter(Boolean).pop();
    const clinicId = searchParams.get('clinic_id');
    if (!providerId) return NextResponse.json({ error: 'provider_id is required' }, { status: 400 });
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { error } = await supabase
      .from('providers')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', providerId)
      .eq('clinic_id', clinicId);

    if (error) throw new Error(error.message);

    logEvent('clinic_provider_deleted', { clinic_id: clinicId, provider_id: providerId });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_providers_delete_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}