import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSupabaseEnvConfig } from '@/lib/config';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { deleteDemoPatient, updateDemoPatient } from '@/lib/demoState';

export async function PUT(request: Request) {
  const { pathname, searchParams } = new URL(request.url);
  const patientId = pathname.split('/').filter(Boolean).pop();
  const clinicId = searchParams.get('clinic_id');
  const body = await request.json();

  if (!patientId) {
    return NextResponse.json({ error: 'Patient id is required' }, { status: 400 });
  }
  if (!clinicId) {
    return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
  }

  const config = getSupabaseEnvConfig();
  if (!config.isConfigured) {
    const updated = updateDemoPatient(patientId, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      notes: body.notes,
      source: body.source ?? 'موقع الويب',
      status: body.status ?? 'جديد',
    });
    if (!updated) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  }

  const authorization = await authorizeClinicRequest(request, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
  }

  const supabase = supabaseAdmin;
  const { data, error } = await supabase.from('patients').update({
    full_name: body.name,
    email: body.email,
    phone_number: body.phone,
    notes: body.notes,
    metadata: { source: body.source ?? 'موقع الويب', status: body.status ?? 'جديد' },
  }).eq('id', patientId).eq('clinic_id', clinicId).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const { pathname, searchParams } = new URL(request.url);
  const patientId = pathname.split('/').filter(Boolean).pop();
  const clinicId = searchParams.get('clinic_id');

  if (!patientId) {
    return NextResponse.json({ error: 'Patient id is required' }, { status: 400 });
  }
  if (!clinicId) {
    return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
  }

  const config = getSupabaseEnvConfig();
  if (!config.isConfigured) {
    const deleted = deleteDemoPatient(patientId);
    if (!deleted) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  const authorization = await authorizeClinicRequest(request, clinicId);
  if (!authorization.authorized) {
    return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
  }

  const supabase = supabaseAdmin;
  const { error } = await supabase.from('patients').delete().eq('id', patientId).eq('clinic_id', clinicId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}