import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';

const updateSchema = z.object({
  title: z.string().min(1, 'العنوان مطلوب').optional(),
  description: z.string().optional(),
  image_url: z.string().url('رابط الصورة غير صالح').optional(),
  cta_text: z.string().optional(),
  cta_link: z.string().optional(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export async function PUT(req: Request, { params }: { params: { adId: string } }) {
  try {
    const { adId } = params;
    const body = await req.json();
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? body.clinic_id ?? '';

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data', details: parsed.error.errors }, { status: 400 });
    }

    const { data: ad, error } = await supabaseAdmin
      .from('clinic_ads')
      .update(parsed.data)
      .eq('id', adId)
      .eq('clinic_id', clinicId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to update ad', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { ad } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { adId: string } }) {
  try {
    const { adId } = params;
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id') ?? '';

    const auth = await authorizeClinicRequest(req, clinicId);
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });
    }

    const { error } = await supabaseAdmin
      .from('clinic_ads')
      .delete()
      .eq('id', adId)
      .eq('clinic_id', clinicId);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete ad', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { success: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
