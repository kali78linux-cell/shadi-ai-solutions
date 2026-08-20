import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const registerSchema = z.object({
  clinic_name: z.string().min(1).max(200),
  clinic_slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers, and dashes'),
});

export async function POST(req: Request) {
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid registration payload', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_name, clinic_slug } = parsed.data;

    // Check slug uniqueness
    const { data: existingClinic } = await supabaseAdmin
      .from('clinics')
      .select('id')
      .eq('slug', clinic_slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingClinic) {
      return NextResponse.json({ error: 'This clinic URL is already taken. Please choose another.' }, { status: 409 });
    }

    // Create the clinic
    const { data: clinic, error: clinicError } = await supabaseAdmin
      .from('clinics')
      .insert({
        name: clinic_name,
        slug: clinic_slug,
        settings: { timezone: 'Asia/Jerusalem', default_appointment_duration_minutes: 30 },
      })
      .select('id, name, slug')
      .single();
    if (clinicError) throw new Error(clinicError.message);

    // Create owner membership
    const { error: memberError } = await supabaseAdmin.from('clinic_users').insert({
      clinic_id: clinic.id,
      user_id: authData.user.id,
      role: 'owner',
    });
    if (memberError) throw new Error(memberError.message);

    logEvent('clinic_registered', { clinic_id: clinic.id, user_id: authData.user.id });
    return NextResponse.json({ data: clinic }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('auth_register_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}