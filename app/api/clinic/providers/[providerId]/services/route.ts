import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const assignmentSchema = z.object({ service_ids: z.array(z.string().uuid()).max(100) });

export async function GET(req: Request) {
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
    const { data: provider, error: providerError } = await supabase.from('providers').select('id').eq('id', providerId).eq('clinic_id', clinicId).single();
    if (providerError || !provider) return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });

    const { data, error } = await supabase.from('provider_services').select('service_id').eq('clinic_id', clinicId).eq('provider_id', providerId);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data: (data || []).map((r) => r.service_id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('provider_services_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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
    const parsed = assignmentSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid assignment payload', details: parsed.error.errors }, { status: 400 });

    const supabase = supabaseAdmin;
    const { data: provider, error: providerError } = await supabase.from('providers').select('id').eq('id', providerId).eq('clinic_id', clinicId).single();
    if (providerError || !provider) return NextResponse.json({ error: 'Provider not found for this clinic' }, { status: 404 });

    // Verify all services belong to this clinic
    const { data: services, error: servicesError } = await supabase.from('clinic_services').select('id').eq('clinic_id', clinicId).in('id', parsed.data.service_ids);
    if (servicesError) throw new Error(servicesError.message);
    const validIds = new Set((services || []).map((s) => s.id));
    for (const id of parsed.data.service_ids) {
      if (!validIds.has(id)) return NextResponse.json({ error: 'Service not found for this clinic' }, { status: 404 });
    }

    // Replace assignments: delete existing, insert new
    const { error: delError } = await supabase.from('provider_services').delete().eq('clinic_id', clinicId).eq('provider_id', providerId);
    if (delError) throw new Error(delError.message);

    if (parsed.data.service_ids.length > 0) {
      const rows = parsed.data.service_ids.map((serviceId) => ({ clinic_id: clinicId, provider_id: providerId, service_id: serviceId }));
      const { error: insError } = await supabase.from('provider_services').insert(rows);
      if (insError) throw new Error(insError.message);
    }

    logEvent('provider_services_updated', { clinic_id: clinicId, provider_id: providerId });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('provider_services_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}