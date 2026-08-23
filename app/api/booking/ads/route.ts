import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolvePublicClinic } from '@/lib/services/clinics';

const querySchema = z.object({
  clinic_id: z.string().uuid().optional(),
  slug: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().min(1).max(20).default(5),
}).refine((data) => data.clinic_id || data.slug, {
  message: 'Either clinic_id or slug is required',
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      clinic_id: url.searchParams.get('clinic_id') ?? undefined,
      slug: url.searchParams.get('slug') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id: cid, slug, limit } = parsed.data;

    // Resolve the clinic (public-safe — no auth required)
    const clinic = await resolvePublicClinic({ id: cid, slug });
    if (!clinic) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);

    // Only return active ads that are within their date range
    const { data: ads, error } = await supabaseAdmin
      .from('clinic_ads')
      .select('id, title, description, image_url, cta_text, cta_link, display_order')
      .eq('clinic_id', clinic.id)
      .eq('is_active', true)
      .or(`start_date.is.null,start_date.lte.${today}`)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order('display_order', { ascending: true })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: 'Failed to load ads', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: { ads: ads || [] } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 });
  }
}
