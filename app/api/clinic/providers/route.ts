import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const providerSchema = z.object({
  name: z.string().min(1).max(200),
  title: z.string().max(200).optional().nullable(),
  provider_type: z.enum(['dentist', 'hygienist', 'staff']).default('dentist'),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
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
      .from('providers')
      .select('id, name, title, provider_type, email, phone, deleted_at')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ data: (data || []).map((p) => ({ ...p, active: !p.deleted_at })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_providers_get_error', { error: message }, 'error');
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
    const parsed = providerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid provider payload', details: parsed.error.errors }, { status: 400 });
    }

    const supabase = supabaseAdmin;
    const userId = authorization.user?.id && authorization.user.id !== 'demo-user' ? authorization.user.id : null;
    const { data, error } = await supabase
      .from('providers')
      .insert({
        clinic_id: clinicId,
        user_id: userId,
        name: parsed.data.name,
        title: parsed.data.title ?? null,
        provider_type: parsed.data.provider_type,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        deleted_at: parsed.data.active ? null : new Date().toISOString(),
      })
      .select('id, name, title, provider_type, email, phone, deleted_at')
      .single();

    if (error) throw new Error(error.message);

    // Ensure a default schedule row exists so the provider is visible in public booking.
    // getActiveProviders only returns providers that have provider_schedules rows.
    const { error: scheduleError } = await supabase.from('provider_schedules').insert({
      clinic_id: clinicId,
      provider_id: data.id,
      weekday: 1, // Monday
      enabled: true,
      start_time: '09:00',
      end_time: '17:00',
      breaks: [],
      appointment_duration_minutes: 30,
    });
    if (scheduleError) {
      logEvent('clinic_provider_default_schedule_error', { clinic_id: clinicId, provider_id: data.id, error: scheduleError.message }, 'error');
    }

    logEvent('clinic_provider_created', { clinic_id: clinicId, provider_id: data.id });
    return NextResponse.json({ data: { ...data, active: !data.deleted_at } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_providers_post_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}