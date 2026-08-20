import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const aiSettingsSchema = z.object({
  assistant_name: z.string().min(1).max(200).optional(),
  tone: z.string().max(200).optional().nullable(),
  language: z.string().max(50).optional().nullable(),
  greeting: z.string().max(1000).optional().nullable(),
  lead_detection_enabled: z.boolean().optional(),
  appointment_booking_enabled: z.boolean().optional(),
  knowledge_retrieval_enabled: z.boolean().optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
  safety_controls: z.record(z.unknown()).optional().nullable(),
  show_service_prices_to_patients: z.boolean().optional(),
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
      .from('clinic_ai_settings')
      .select('*')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return NextResponse.json({ data: data ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_ai_settings_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const body = await req.json();
    const parsed = aiSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid AI settings payload', details: parsed.error.errors }, { status: 400 });
    }

    const supabase = supabaseAdmin;
    const update: Record<string, unknown> = {};
    if (parsed.data.assistant_name !== undefined) update.assistant_name = parsed.data.assistant_name;
    if (parsed.data.tone !== undefined) update.tone = parsed.data.tone;
    if (parsed.data.language !== undefined) update.language = parsed.data.language;
    if (parsed.data.greeting !== undefined) update.greeting = parsed.data.greeting;
    if (parsed.data.lead_detection_enabled !== undefined) update.lead_detection_enabled = parsed.data.lead_detection_enabled;
    if (parsed.data.appointment_booking_enabled !== undefined) update.appointment_booking_enabled = parsed.data.appointment_booking_enabled;
    if (parsed.data.knowledge_retrieval_enabled !== undefined) update.knowledge_retrieval_enabled = parsed.data.knowledge_retrieval_enabled;
    if (parsed.data.confidence_threshold !== undefined) update.confidence_threshold = parsed.data.confidence_threshold;
    if (parsed.data.safety_controls !== undefined) update.safety_controls = parsed.data.safety_controls;
    if (parsed.data.show_service_prices_to_patients !== undefined) update.show_service_prices_to_patients = parsed.data.show_service_prices_to_patients;

    // Upsert: if no row exists, create one for this clinic
    const { data: existing } = await supabase
      .from('clinic_ai_settings')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('clinic_ai_settings')
        .update(update)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      result = data;
    } else {
      const { data, error } = await supabase
        .from('clinic_ai_settings')
        .insert({ clinic_id: clinicId, ...update })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      result = data;
    }

    logEvent('clinic_ai_settings_updated', { clinic_id: clinicId });
    return NextResponse.json({ data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_ai_settings_put_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}