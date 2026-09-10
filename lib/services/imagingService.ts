import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * PHASE A — Imaging Domain model + Canonical Booking adapter.
 *
 * `imaging_services` is the specialized catalog for imaging centers
 * (panorama / CBCT variants / sections ...). Booking itself still runs through
 * the canonical generic service stored in `clinic_services` (that is the table
 * `createBooking()` and `/book` read from). This module is the adapter that
 * keeps the two in sync BY NAME so that:
 *   - AI / public page read the rich imaging domain data,
 *   - booking / availability / validation read the generic service + its
 *     (now general) `requires_provider` flag.
 *
 * Provider-optionality is a GENERAL behaviour (clinic_services.requires_provider),
 * not an imaging-specific hack.
 */

export type ImagingService = {
  id: string;
  name: string;
  modality: string | null;
  description: string | null;
  duration_minutes: number | null;
  turnaround_hours: number | null;
  pricing_mode: 'unspecified' | 'fixed' | 'range' | 'estimate' | 'case_by_case';
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  price_note: string | null;
  requires_provider: boolean;
  preparation_instructions: string | null;
  report_policy: string | null;
  delivery_methods: string[];
  sort_order: number;
};

type ImagingRow = {
  name: string;
  modality: string | null;
  description: string | null;
  duration_minutes: number | null;
  turnaround_hours: number | null;
  pricing_mode: string | null;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
  price_note: string | null;
  requires_provider: boolean | null;
  preparation_instructions: string | null;
  report_policy: string | null;
  delivery_methods: unknown;
  sort_order: number | null;
};

const MAPPED_PRICING: Record<string, ImagingService['pricing_mode']> = {
  fixed: 'fixed',
  range: 'range',
  estimate: 'estimate',
  case_by_case: 'case_by_case',
  unspecified: 'unspecified',
};

/** Loads the active imaging catalog for a tenant. Empty when the table has no rows. */
export async function getImagingServices(clinicId: string): Promise<ImagingService[]> {
  const { data, error } = await supabaseAdmin
    .from('imaging_services')
    .select(
      'name, modality, description, duration_minutes, turnaround_hours, pricing_mode, price, price_min, price_max, price_note, requires_provider, preparation_instructions, report_policy, delivery_methods, sort_order'
    )
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });
  if (error) return [];
  return (data ?? []).map((r: ImagingRow) => ({
    id: r.name as string, // stable natural key; real bookings use clinic_services.id
    name: r.name,
    modality: r.modality ?? null,
    description: r.description ?? null,
    duration_minutes: r.duration_minutes ?? null,
    turnaround_hours: r.turnaround_hours ?? null,
    pricing_mode: MAPPED_PRICING[r.pricing_mode ?? 'unspecified'] ?? 'unspecified',
    price: r.price != null && Number(r.price) > 0 ? Number(r.price) : null,
    price_min: r.price_min != null ? Number(r.price_min) : null,
    price_max: r.price_max != null ? Number(r.price_max) : null,
    price_note: r.price_note ?? null,
    requires_provider: r.requires_provider === true,
    preparation_instructions: r.preparation_instructions ?? null,
    report_policy: r.report_policy ?? null,
    delivery_methods: Array.isArray(r.delivery_methods) ? (r.delivery_methods as string[]) : [],
    sort_order: r.sort_order ?? 0,
  }));
}

/**
 * True when the GENERIC booking source (clinic_services) marks this service as
 * requiring a provider. This is what booking/availability/AI trust — one rule.
 */
export async function serviceRequiresProvider(clinicId: string, serviceId: string | null): Promise<boolean> {
  if (!serviceId) return false;
  const { data, error } = await supabaseAdmin
    .from('clinic_services')
    .select('requires_provider')
    .eq('clinic_id', clinicId)
    .eq('id', serviceId)
    .maybeSingle();
  if (error || !data) return false;
  return data.requires_provider === true;
}

/** Patient-facing price phrase for imaging (fixed → "30 ILS", range → "70–300 ILS"). */
export function describeImagingPrice(svc: ImagingService): string | null {
  switch (svc.pricing_mode) {
    case 'fixed':
      return svc.price != null ? `${svc.price} ILS` : svc.price_note ?? null;
    case 'range':
      if (svc.price_min != null && svc.price_max != null) return `${svc.price_min}–${svc.price_max} ILS`;
      return svc.price_note ?? null;
    case 'estimate':
      return svc.price_min != null ? `≈${svc.price_min} ILS` : svc.price_note ?? null;
    case 'case_by_case':
    case 'unspecified':
    default:
      return svc.price_note ?? null;
  }
}