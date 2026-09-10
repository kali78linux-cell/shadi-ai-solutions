import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { getAppBaseUrl } from '@/lib/communications/links';
import { readDisplaySettings, readTheme, type PublicDisplaySettings, type PublicThemeSettings } from '@/lib/services/clinicPublicConfig';

/**
 * STEP 15D — Public Clinic Profile projection.
 *
 * Deny-by-default: only the fields listed below may ever reach the public.
 * Nothing here exposes patients, staff identities, conversations, knowledge,
 * AI settings, billing, or internal identifiers beyond the public slug/id.
 *
 * Privacy flags (opt-in, from clinics.settings):
 *   - show_phone  (default: false) — clinic phone is hidden unless enabled
 *   - show_prices (default: false) — service prices hidden unless enabled
 *     (per-service visibility is still additionally gated by
 *      clinic_services.price_visible_to_patients)
 *   - description (optional public marketing text)
 */

export type PublicService = {
  name: string;
  description: string | null;
  duration_minutes: number | null;
  price: number | null;
  price_min: number | null;
  price_max: number | null;
};

export type PublicWorkingHour = {
  weekday: number; // 0=Sunday .. 6=Saturday (provider_schedules convention)
  start_time: string;
  end_time: string;
};

export type PublicProvider = {
  name: string;
  title: string | null;
  specialty: string | null;
};

export type PublicAd = {
  title: string;
  description: string | null;
  image_url: string | null;
  cta_text: string;
  cta_link: string | null;
};

export type PublicSocialLinks = {
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  website?: string;
};

export type PublicSectionKey =
  | 'hero' | 'about' | 'services' | 'providers' | 'hours' | 'offers'
  | 'gallery' | 'contact' | 'bookingCta' | 'aiCta' | 'qrShare';

export type PublicClinicProfile = {
  id: string;
  public_id: string | null;
  slug: string;
  name: string;
  logo: string | null;
  description: string | null;
  tagline: string | null;
  about: string | null;
  cover_url: string | null;
  social_links: PublicSocialLinks;
  sections: Partial<Record<PublicSectionKey, boolean>>;
  city: string | null;
  area: string | null;
  address: string | null;
  phone: string | null; // null unless public_profile.show_phone === true
  services: PublicService[];
  providers: PublicProvider[];
  ads: PublicAd[];
  workingHours: PublicWorkingHour[];
  bookingUrl: string;
  chatUrl: string;
  pageUrl: string;
  /** Bounded display controls (public_profile.display) — renderer maps to approved classes. */
  display: PublicDisplaySettings;
  /** Bounded theme (public_profile.theme) — hex colors only; never raw CSS. */
  theme: PublicThemeSettings;
};

/** Builds the canonical public page URL for a clinic slug. */
export function publicClinicUrl(
  slug: string,
  env: Record<string, string | undefined> = process.env
): string {
  const base = getAppBaseUrl(env);
  return `${base}/c/${encodeURIComponent(slug)}`;
}

type PublicProfileShape = {
  description?: unknown;
  tagline?: unknown;
  about?: unknown;
  cover_url?: unknown;
  show_phone?: unknown;
  show_prices?: unknown;
  social_links?: unknown;
  sections?: unknown;
  show_providers?: unknown;
  hidden_services?: unknown;
  hidden_providers?: unknown;
};

type ClinicSettingsShape = {
  // LEGACY top-level flags (original STEP 15D shape). The canonical owner
  // screen writes inside settings.public_profile — we read the canonical
  // nested flags first and fall back to these only for old tenants.
  show_phone?: unknown;
  show_prices?: unknown;
  public_profile?: PublicProfileShape | null;
};

const SECTION_KEYS: PublicSectionKey[] = [
  'hero', 'about', 'services', 'providers', 'hours', 'offers',
  'gallery', 'contact', 'bookingCta', 'aiCta', 'qrShare',
];

function readSections(raw: unknown): Partial<Record<PublicSectionKey, boolean>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<PublicSectionKey, boolean>> = {};
  for (const key of SECTION_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

function readSocialLinks(raw: unknown): PublicSocialLinks {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: PublicSocialLinks = {};
  for (const key of ['facebook', 'instagram', 'whatsapp', 'website'] as const) {
    const v = src[key];
    if (typeof v === 'string' && v.trim() && v.length <= 500) {
      out[key] = v.trim();
    }
  }
  return out;
}

function readPublicText(value: unknown, max = 5000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function readFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Resolves the full public profile for a clinic by slug or id.
 * Returns null when the clinic does not exist or is soft-deleted.
 * All data is fetched server-side via the service client and reduced
 * to the explicit allow-list above.
 */
export async function getPublicClinicProfile(
  params: { id?: string; slug?: string }
): Promise<PublicClinicProfile | null> {
  const clinic = await resolvePublicClinic(params);
  if (!clinic) {
    return null;
  }

  // Narrow second read for public-only columns of the resolved clinic.
  const { data: clinicRow } = await supabaseAdmin
    .from('clinics')
    .select('id, public_id, slug, name, logo, city, area, address_detail, phone, settings')
    .eq('id', clinic.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!clinicRow) {
    return null;
  }

  const settings = (clinicRow.settings ?? {}) as ClinicSettingsShape;
  // CANONICAL SOURCE: settings.public_profile (what the owner screen and
  // createClinic defaults write). Legacy top-level show_phone/show_prices
  // are honored only as a fallback for tenants created before the owner
  // experience existed. Root-cause fix for dashboard→public persistence:
  // the loader previously read top-level flags only, silently dropping
  // every nested value the dashboard saved.
  const pp = (settings.public_profile ?? {}) as PublicProfileShape;
  const showPhone = readFlag(pp.show_phone) || readFlag(settings.show_phone);
  const showPrices = readFlag(pp.show_prices) || readFlag(settings.show_prices);
  // Providers on the public space default ON (booking shows them anyway);
  // the clinic may hide the section via public_profile.show_providers=false.
  const showProviders = pp.show_providers !== false;
  const description = readPublicText(pp.description);
  const tagline = readPublicText(pp.tagline, 300);
  const about = readPublicText(pp.about, 8000);
  const coverUrl =
    typeof pp.cover_url === 'string' && /^https?:\/\//.test(pp.cover_url) ? pp.cover_url : null;
  const socialLinks = readSocialLinks(pp.social_links);
  const sections = readSections(pp.sections);

  // Owner-managed public visibility (CLINIC PUBLIC PAGE OWNER EXPERIENCE):
  // hidden_services / hidden_providers are presentation-only — they never
  // touch booking eligibility (clinic_services.active / provider_services).
  const hiddenServices = new Set(
    Array.isArray(pp.hidden_services) ? pp.hidden_services.map(String) : []
  );
  const hiddenProviders = new Set(
    Array.isArray(pp.hidden_providers) ? pp.hidden_providers.map(String) : []
  );

  // Active services — clinic-scoped by the resolved id exclusively.
  const { data: servicesRows } = await supabaseAdmin
    .from('clinic_services')
    .select(
      'id, name, description, duration_minutes, price, price_min, price_max, price_visible_to_patients'
    )
    .eq('clinic_id', clinic.id)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  const services: PublicService[] = (servicesRows ?? [])
    .filter((s) => !hiddenServices.has(s.id))
    .map((s) => {
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

  // Aggregated working hours — merged across providers, no provider names.
  const { data: scheduleRows } = await supabaseAdmin
    .from('provider_schedules')
    .select('weekday, start_time, end_time')
    .eq('clinic_id', clinic.id)
    .eq('enabled', true);

  const byWeekday = new Map<number, { start: string; end: string }>();
  for (const row of scheduleRows ?? []) {
    if (typeof row.weekday !== 'number' || !row.start_time || !row.end_time) {
      continue;
    }
    const existing = byWeekday.get(row.weekday);
    if (!existing) {
      byWeekday.set(row.weekday, { start: row.start_time, end: row.end_time });
    } else {
      if (row.start_time < existing.start) existing.start = row.start_time;
      if (row.end_time > existing.end) existing.end = row.end_time;
    }
  }
  const workingHours: PublicWorkingHour[] = Array.from(byWeekday.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, v]) => ({ weekday, start_time: v.start, end_time: v.end }));

  // Public providers (name/title/specialty only — never contact or internal ids).
  let providers: PublicProvider[] = [];
  if (showProviders) {
    const { data: providerRows } = await supabaseAdmin
      .from('providers')
      .select('id, name, title, specialty')
      .eq('clinic_id', clinic.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(12);
    providers = (providerRows ?? [])
      .filter((p) => !hiddenProviders.has(p.id))
      .map((p) => ({
        name: p.name,
        title: p.title ?? null,
        specialty: p.specialty ?? null,
      }));
  }

  // Active announcements/offers (clinic_ads) — date-windowed, tenant-scoped.
  const { data: adRows } = await supabaseAdmin
    .from('clinic_ads')
    .select('title, description, image_url, cta_text, cta_link')
    .eq('clinic_id', clinic.id)
    .eq('is_active', true)
    .is('deleted_at', null)
    .lte('start_date', new Date().toISOString().slice(0, 10))
    .gte('end_date', new Date().toISOString().slice(0, 10))
    .order('display_order', { ascending: true })
    .limit(6);
  const ads: PublicAd[] = (adRows ?? []).map((a) => ({
    title: a.title,
    description: a.description ?? null,
    image_url: a.image_url ?? null,
    cta_text: a.cta_text ?? 'اعرف المزيد',
    cta_link: a.cta_link ?? null,
  }));

  return {
    id: clinic.id,
    public_id: clinicRow.public_id ?? null,
    slug: clinicRow.slug,
    name: clinicRow.name,
    logo: clinicRow.logo ?? null,
    description,
    tagline,
    about,
    cover_url: coverUrl,
    social_links: socialLinks,
    sections,
    city: clinicRow.city ?? null,
    area: clinicRow.area ?? null,
    address: clinicRow.address_detail ?? null,
    phone: showPhone ? (clinicRow.phone ?? null) : null,
    services,
    providers,
    ads,
    workingHours,
    bookingUrl: `/book?slug=${encodeURIComponent(clinicRow.slug)}`,
    chatUrl: `/chat?clinic=${encodeURIComponent(clinicRow.slug)}`,
    pageUrl: publicClinicUrl(clinicRow.slug),
    display: readDisplaySettings(clinicRow.settings),
    theme: readTheme(clinicRow.settings),
  };
}
