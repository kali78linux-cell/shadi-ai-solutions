import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveServices } from '@/lib/services/bookingService';
import { logEvent } from '@/lib/server/logging';
import { supabaseAdmin } from '@/lib/supabase/admin';

const servicesSchema = z.object({
  clinic_id: z.string().uuid(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = servicesSchema.safeParse({
      clinic_id: url.searchParams.get('clinic_id'),
    });

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request parameters', details: parsed.error.errors }, { status: 400 });
    }

    const { clinic_id } = parsed.data;
    const services = await getActiveServices(clinic_id);

    // Respect price visibility: hide prices from patients unless the clinic
    // has enabled show_service_prices_to_patients.
    let showPrices = false;
    try {
      const { data: settings } = await supabaseAdmin
        .from('clinic_ai_settings')
        .select('show_service_prices_to_patients')
        .eq('clinic_id', clinic_id)
        .maybeSingle();
      showPrices = Boolean(settings?.show_service_prices_to_patients);
    } catch {
      showPrices = false;
    }

    const responseServices = showPrices
      ? services
      : services.map((s) => ({ id: s.id, name: s.name, description: s.description, duration_minutes: s.duration_minutes }));

    return NextResponse.json({ data: { clinic_id, services: responseServices } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('booking_services_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}