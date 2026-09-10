import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { publicClinicUrl } from '@/lib/services/clinicPublicProfile';
import { getAppBaseUrl } from '@/lib/communications/links';
import { PUBLISHABLE_PROVIDER_TYPES } from '@/lib/services/providerVisibility';

/**
 * PP-8B-ii — Public Doctor Profile projection.
 *
 * THE single public projection for a doctor. The /d/{slug} page consumes it
 * today; PP-8C (sitemap/JSON-LD) and PP-8D (/discover) must consume THE SAME
 * service — no per-surface queries for the same entity.
 *
 * Deny-by-default allow-list (spec §8.1). Never exposed: provider email/phone,
 * user_id, provider uuid, patients, conversations, internal stats, anything
 * not listed below. Private identities (non-publishable provider types) and
 * private visibility never resolve. Soft-deleted provider or clinic → null.
 */

export type DoctorPublicService = {
  name: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
};

export type DoctorPublicWorkingHour = {
  weekday: number; // 0=Sunday .. 6=Saturday
  start_time: string;
  end_time: string;
};

export type DoctorPublicProfile = {
  slug: string;
  name: string;
  title: string | null;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
  visibility: 'noindex' | 'indexable';
  clinic: {
    name: string;
    slug: string;
    city: string | null;
    area: string | null;
    address: string | null;
    phone: string | null; // null unless clinic settings.show_phone === true
    pageUrl: string;
  };
  services: DoctorPublicService[];
  workingHours: DoctorPublicWorkingHour[];
  bookingUrl: string;
  chatUrl: string;
  pageUrl: string;
};

/** Canonical public page URL for a doctor slug. */
export function doctorPublicUrl(
  slug: string,
  env: Record<string, string | undefined> = process.env
): string {
  const base = getAppBaseUrl(env);
  return `${base}/d/${encodeURIComponent(slug)}`;
}

type ClinicSettingsShape = {
  show_phone?: unknown;
  show_prices?: unknown;
};

function readFlag(value: unknown): boolean {
  return value === true;
}

export async function getDoctorPublicProfile(
  params: { slug?: string }
): Promise<DoctorPublicProfile | null> {
  if (!params.slug) return null;

  // 1) Resolve the provider by its stable public slug — public rows only.
  const { data: providerRow, error: providerError } = await supabaseAdmin
    .from('providers')
    .select(
      'id, name, title, specialty, bio, photo_url, public_slug, public_visibility, provider_type, clinic_id'
    )
    .eq('public_slug', params.slug)
    .neq('public_visibility', 'private')
    .is('deleted_at', null)
    .maybeSingle();
  if (providerError) throw new Error(providerError.message);
  if (
    !providerRow ||
    !PUBLISHABLE_PROVIDER_TYPES.includes(
      providerRow.provider_type as (typeof PUBLISHABLE_PROVIDER_TYPES)[number]
    )
  ) {
    return null;
  }

  // 2) The provider's clinic must exist and be active (central resolver).
  const clinic = await resolvePublicClinic({ id: providerRow.clinic_id });
  if (!clinic) return null;

  // 3) Narrow clinic read for public-only columns (mirror of 15D).
  const { data: clinicRow } = await supabaseAdmin
    .from('clinics')
    .select('id, slug, name, city, area, address_detail, phone, settings')
    .eq('id', clinic.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!clinicRow) return null;

  const settings = (clinicRow.settings ?? {}) as ClinicSettingsShape;
  const showPhone = readFlag(settings.show_phone);
  const showPrices = readFlag(settings.show_prices);

  // 4) Clinic-scoped active services (same price gating as 15D).
  const { data: servicesRows } = await supabaseAdmin
    .from('clinic_services')
    .select(
      'name, description, duration_minutes, price, price_min, price_max, price_visible_to_patients'
    )
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const services: DoctorPublicService[] = (servicesRows ?? []).map((s) => {
    const priceVisible = showPrices && s.price_visible_to_patients === true;
    return {
      name: s.name,
      description: s.description ?? null,
      duration_minutes: s.duration_minutes ?? null,
      price: priceVisible ? (s.price ?? null) : null,
      price_min: priceVisible ? (s.price_min ?? null) : null,
      price_max: priceVisible ? (s.price_max ?? null) : null,
    };
  });

  // 5) Aggregated working hours — merged across providers, no provider names.
  const { data: scheduleRows } = await supabaseAdmin
    .from('provider_schedules')
    .select('weekday, start_time, end_time')
    .eq('clinic_id', clinic.id)
    .eq('enabled', true);

  const byWeekday = new Map<number, { start: string; end: string }>();
  for (const row of scheduleRows ?? []) {
    if (typeof row.weekday !== 'number' || !row.start_time || !row.end_time) continue;
    const existing = byWeekday.get(row.weekday);
    if (!existing) byWeekday.set(row.weekday, { start: row.start_time, end: row.end_time });
    else {
      if (row.start_time < existing.start) existing.start = row.start_time;
      if (row.end_time > existing.end) existing.end = row.end_time;
    }
  }
  const workingHours: DoctorPublicWorkingHour[] = Array.from(byWeekday.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, v]) => ({ weekday, start_time: v.start, end_time: v.end }));

  const slug = providerRow.public_slug as string;

  return {
    slug,
    name: providerRow.name,
    title: providerRow.title ?? null,
    specialty: providerRow.specialty ?? null,
    bio: providerRow.bio ?? null,
    photo_url: providerRow.photo_url ?? null,
    visibility: providerRow.public_visibility as 'noindex' | 'indexable',
    clinic: {
      name: clinicRow.name,
      slug: clinicRow.slug,
      city: clinicRow.city ?? null,
      area: clinicRow.area ?? null,
      address: clinicRow.address_detail ?? null,
      phone: showPhone ? (clinicRow.phone ?? null) : null,
      pageUrl: publicClinicUrl(clinicRow.slug),
    },
    services,
    workingHours,
    bookingUrl: `/book?slug=${encodeURIComponent(clinicRow.slug)}`,
    chatUrl: `/chat?clinic=${encodeURIComponent(clinicRow.slug)}`,
    pageUrl: doctorPublicUrl(slug),
  };
}

// ---------------------------------------------------------------------------
// PP-8C — SEO Foundations: sitemap entries (indexable public profiles ONLY).
// ---------------------------------------------------------------------------

export type PublicProfileSeoEntry = {
  /** Public slug — entity-kind scoped (doctor today; more kinds via PP-8D later). */
  kind: 'doctor';
  slug: string;
  lastModified: Date | null;
};

/**
 * Sitemap source of truth (PP-8C): ONLY `public_visibility = 'indexable'`
 * profiles of publishable, non-deleted providers whose clinic is active.
 * Private/noindex profiles can NEVER appear here (spec AC-8). Doctor-kind
 * today — the listing stays entity-kind-scoped for future kinds (D9).
 */
export async function getPublicProfileSeoEntries(): Promise<PublicProfileSeoEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('providers')
    .select('public_slug, updated_at, clinics!inner(deleted_at)')
    .eq('public_visibility', 'indexable')
    .is('deleted_at', null)
    .is('clinics.deleted_at', null)
    .not('public_slug', 'is', null);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r: any) => typeof r.public_slug === 'string' && r.public_slug.length > 0)
    .map((r: any) => ({
      kind: 'doctor' as const,
      slug: r.public_slug as string,
      lastModified: r.updated_at ? new Date(r.updated_at) : null,
    }));
}

// ---------------------------------------------------------------------------
// PP-8D — Discovery V1: public directory entries (eligibility-gated).
// ---------------------------------------------------------------------------

export const DISCOVERY_PAGE_SIZE = 20;
const DISCOVERY_MAX_SCAN = 500;

export type DiscoveryEntry = {
  /** Entity-kind scoped (D9): doctor today; more kinds in future phases. */
  kind: 'doctor';
  slug: string;
  name: string;
  specialty: string | null;
  title: string | null;
  photo_url: string | null;
  clinicName: string;
  clinicSlug: string;
  city: string | null;
  area: string | null;
};

export type DiscoverySearchParams = {
  q?: string;
  specialty?: string;
  city?: string;
  page?: number;
};

export type DiscoveryResult = {
  entries: DiscoveryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type DiscoveryCandidateRow = {
  public_slug: string;
  name: string;
  specialty: string | null;
  title: string | null;
  photo_url: string | null;
  provider_type: string;
  clinic_id: string;
  clinics: {
    slug: string;
    name: string;
    city: string | null;
    area: string | null;
    settings: unknown;
  } | null;
};

type SubStatusRow = { clinic_id: string; status: string };

function readDiscoveryFlag(settings: unknown): boolean {
  const s = (settings ?? {}) as { public_profile?: { discovery_enabled?: unknown } | null };
  return s.public_profile?.discovery_enabled === true;
}

/**
 * PP-8D — Discovery V1 directory query. READ-ONLY public projection.
 *
 * Eligibility contract (ALL of):
 *   - provider: public_visibility = 'indexable' · publishable type · not deleted
 *   - public_slug present · clinic active (inner join, deleted_at null)
 *   - clinic: settings.public_profile.discovery_enabled === true (PP-8A opt-in)
 *   - clinic subscription: latest non-deleted row has status 'active'|'trialing'
 *
 * Search: doctor name / specialty / clinic city-or-area (ILIKE contains).
 * Deterministic ordering (name asc) — no scoring, no ranking (spec §9.2).
 * Entity-kind scoped (D9): doctor today; future kinds extend, never re-query.
 * Zero private fields returned (no email/phone/user_id/patient data).
 */
export async function getDiscoveryEntries(
  params: DiscoverySearchParams = {}
): Promise<DiscoveryResult> {
  const pageSize = DISCOVERY_PAGE_SIZE;
  const page = Math.max(1, Math.floor(params.page ?? 1) || 1);

  let builder = supabaseAdmin
    .from('providers')
    .select(
      'public_slug, name, specialty, title, photo_url, provider_type, clinic_id, clinics!inner(slug, name, city, area, settings, deleted_at)'
    )
    .eq('public_visibility', 'indexable')
    .in('provider_type', [...PUBLISHABLE_PROVIDER_TYPES])
    .is('deleted_at', null)
    .is('clinics.deleted_at', null)
    .not('public_slug', 'is', null)
    .limit(DISCOVERY_MAX_SCAN);

  const q = params.q?.trim();
  if (q) builder = builder.ilike('name', `%${q}%`);
  const specialty = params.specialty?.trim();
  if (specialty) builder = builder.ilike('specialty', `%${specialty}%`);
  const city = params.city?.trim();
  if (city) {
    builder = builder.or(`city.ilike.%${city}%,area.ilike.%${city}%`, {
      referencedTable: 'clinics',
    });
  }

  builder = builder.order('name', { ascending: true });

  const { data, error } = await builder;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as DiscoveryCandidateRow[];

  // Clinic-level gates: Discovery opt-in (PP-8A flag) + active subscription.
  const clinicIds = Array.from(new Set(rows.map((r) => r.clinic_id)));
  const subscriptionEligible = new Set<string>();
  if (clinicIds.length > 0) {
    const { data: subRows, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('clinic_id, status')
      .in('clinic_id', clinicIds)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    if (subError) throw new Error(subError.message);
    const latestByClinic = new Map<string, string>();
    for (const s of (subRows ?? []) as SubStatusRow[]) {
      if (!latestByClinic.has(s.clinic_id)) latestByClinic.set(s.clinic_id, s.status);
    }
    for (const [clinicId, status] of Array.from(latestByClinic.entries())) {
      if (status === 'active' || status === 'trialing') subscriptionEligible.add(clinicId);
    }
  }

  const eligible = rows.filter((r) => {
    if (!r.clinics) return false;
    if (!readDiscoveryFlag(r.clinics.settings)) return false;
    return subscriptionEligible.has(r.clinic_id);
  });

  const total = eligible.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  const entries: DiscoveryEntry[] = eligible
    .slice(start, start + pageSize)
    .map((r) => ({
      kind: 'doctor' as const,
      slug: r.public_slug,
      name: r.name,
      specialty: r.specialty ?? null,
      title: r.title ?? null,
      photo_url: r.photo_url ?? null,
      clinicName: r.clinics!.name,
      clinicSlug: r.clinics!.slug,
      city: r.clinics!.city ?? null,
      area: r.clinics!.area ?? null,
    }));

  return { entries, total, page: safePage, pageSize, totalPages };
}



