import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

const PRICING_TYPES = ['unspecified', 'fixed', 'estimate', 'range', 'case_by_case'] as const;

/**
 * Services create schema — covers BOTH the legacy price column and the newer
 * pricing_* columns so the UI can round-trip prices without them being
 * silently stripped. Empty-string numeric inputs arrive from HTML forms;
 * they are normalised to null instead of coercing to 0 ("free").
 */
/** HTML forms submit numbers as strings; '' means "not provided" → null. */
const normalizeNumericInput = (body: Record<string, unknown>): Record<string, unknown> => {
  for (const key of ['price', 'price_min', 'price_max']) {
    if (body[key] === '') body[key] = null;
  }
  return body;
};

const serviceSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).nullish(),
    duration_minutes: z.coerce.number().int().min(5).max(480),
    price: z.coerce.number().min(0).nullish(),
    pricing_type: z.enum(PRICING_TYPES).optional(),
    price_min: z.coerce.number().min(0).nullish(),
    price_max: z.coerce.number().min(0).nullish(),
    price_visible_to_patients: z.boolean().optional(),
    active: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    if ((val.pricing_type ?? 'unspecified') === 'range' && val.price_min != null && val.price_max != null && val.price_min > val.price_max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price_max'], message: 'price_max must be >= price_min' });
    }
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
      .from('clinic_services')
      .select('id, name, description, duration_minutes, price, pricing_type, price_min, price_max, price_visible_to_patients, active, deleted_at')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ data: (data || []).map((s) => ({ ...s, active: s.active && !s.deleted_at })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_get_error', { error: message }, 'error');
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

    const roleGate = roleDenied(authorization, ADMIN_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = normalizeNumericInput(await req.json());
    const parsed = serviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid service payload', details: parsed.error.errors }, { status: 400 });
    }

    const supabase = supabaseAdmin;
    const pricingType = parsed.data.pricing_type ?? 'unspecified';
    const priceVisible = parsed.data.price_visible_to_patients ?? true;
    // Keep legacy `price` in sync with a fixed price so old readers stay correct.
    const legacyPrice = parsed.data.price ?? null;

    const { data, error } = await supabase
      .from('clinic_services')
      .insert({
        clinic_id: clinicId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        duration_minutes: parsed.data.duration_minutes,
        price: legacyPrice,
        pricing_type: pricingType,
        price_min: parsed.data.price_min ?? null,
        price_max: parsed.data.price_max ?? null,
        price_visible_to_patients: priceVisible,
        active: parsed.data.active,
        deleted_at: null,
      })
      .select('id, name, description, duration_minutes, price, pricing_type, price_min, price_max, price_visible_to_patients, active, deleted_at')
      .single();

    if (error) throw new Error(error.message);

    logEvent('clinic_service_created', { clinic_id: clinicId, service_id: data.id });
    return NextResponse.json({ data: { ...data, active: data.active && !data.deleted_at } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_services_post_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}