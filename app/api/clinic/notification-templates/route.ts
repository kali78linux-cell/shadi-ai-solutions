import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const templateCreateSchema = z.object({
  name: z.string().min(1).max(200),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
  active: z.boolean().optional(),
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clinicId = searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });

    const { data, error } = await supabaseAdmin
      .from('notification_templates')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_notification_templates_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clinicId = searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status });

    const body = await req.json();
    const parsed = templateCreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid payload', details: parsed.error.errors }, { status: 400 });

    const insert = {
      clinic_id: clinicId,
      name: parsed.data.name,
      subject: parsed.data.subject || null,
      body: parsed.data.body || null,
      active: parsed.data.active ?? true,
    };

    const { data, error } = await supabaseAdmin.from('notification_templates').insert([insert]).select().single();
    if (error) throw error;
    logEvent('clinic_notification_template_created', { clinic_id: clinicId, template_id: data.id });
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_notification_templates_post_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
