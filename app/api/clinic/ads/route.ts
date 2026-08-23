import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';

const createSchema = z.object({
  title: z.string().min(1, 'العنوان مطلوب'),
  description: z.string().optional(),
  image_url: z.string().url('رابط الصورة غير صالح').optional(),
  cta_text: z.string().default('إقرأ المزيد'),
  cta_link: z.string().optional(),
  is_active: z.boolean().default(true),
  display_order: z.number().int().default(0),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const { data: ads, error } = await supabaseAdmin
      .from('clinic_ads')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('display_order', { ascending: true });

    if (error) {
      return NextResponse.json({ error: 'Failed to load ads', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { ads: ads || [] } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? body.clinic_id ?? '';

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data', details: parsed.error.errors }, { status: 400 });
    }

    const { data: ad, error } = await supabaseAdmin
      .from('clinic_ads')
      .insert({ clinic_id: clinicId, ...parsed.data })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to create ad', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { ad } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
