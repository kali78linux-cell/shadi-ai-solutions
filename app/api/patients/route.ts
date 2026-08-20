import { NextResponse } from 'next/server';
import { getSupabaseEnvConfig } from '@/lib/config';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { createDemoPatient, getDemoPatients } from '@/lib/demoState';

type DemoPatient = {
  id: string;
  clinic_id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  notes?: string | null;
};

function toPatientShape(record: any): DemoPatient {
  const source = record?.metadata?.source ?? record?.source ?? 'موقع الويب';
  const status = record?.metadata?.status ?? record?.status ?? 'جديد';
  return {
    id: record?.id ?? crypto.randomUUID(),
    clinic_id: record?.clinic_id ?? '00000000-0000-0000-0000-000000000000',
    name: record?.name ?? record?.full_name ?? 'مريض جديد',
    email: record?.email ?? '',
    phone: record?.phone ?? record?.phone_number ?? '',
    source,
    status,
    created_at: record?.created_at ?? new Date().toISOString(),
    updated_at: record?.updated_at ?? new Date().toISOString(),
    notes: record?.notes ?? null,
  };
}

export async function GET(req: Request) {
  const config = getSupabaseEnvConfig();
  if (!config.isConfigured) {
    return NextResponse.json(getDemoPatients());
  }

  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const searchQuery = url.searchParams.get('q') || undefined;
    const supabase = supabaseAdmin;
    let query = supabase
      .from('patients')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (searchQuery) {
      query = query.or(`full_name.ilike.%${searchQuery}%,phone_number.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json((data || []).map(toPatientShape));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to load patients' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const config = getSupabaseEnvConfig();
  const body = await request.json();
  const payload = {
    id: crypto.randomUUID(),
    clinic_id: body.clinic_id ?? '00000000-0000-0000-0000-000000000000',
    name: body.name ?? body.full_name ?? 'مريض جديد',
    email: body.email ?? '',
    phone: body.phone ?? body.phone_number ?? '',
    source: body.source ?? 'موقع الويب',
    status: body.status ?? 'جديد',
    notes: body.notes ?? null,
  };

  if (!config.isConfigured) {
    const demoPayload = createDemoPatient(payload);
    return NextResponse.json(demoPayload, { status: 201 });
  }

  try {
    const authorization = await authorizeClinicRequest(request, payload.clinic_id);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;
    const { data, error } = await supabase
      .from('patients')
      .insert({
        id: payload.id,
        clinic_id: payload.clinic_id,
        full_name: payload.name,
        email: payload.email,
        phone_number: payload.phone,
        notes: payload.notes,
        metadata: { source: payload.source, status: payload.status },
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(toPatientShape(data), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create patient' }, { status: 500 });
  }
}