import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { getPublicClinicProfile } from '@/lib/services/clinicPublicProfile';
import type { PublicThemeSettings } from '@/lib/services/clinicPublicConfig';
import { normalizeActivityType, type ActivityType } from '@/lib/services/activityTypes';
import { getAppBaseUrl } from '@/lib/communications/links';

/**
 * Digital Healthcare Space — activity public-space resolver (Phase C/E).
 *
 * THE single resolution path for a tenant's public digital space:
 *
 *   /{slug}  →  resolvePublicClinic({slug})  →  activity_type  →
 *              activity-specific public surface (Clinic / Imaging / Lab)
 *
 * Shared tenant identity (clinics table) stays the single source of truth;
 * activity-specific domain data (imaging_services / lab_services) is read as
 * additive, tenant-scoped surfaces — never forced into clinic tables.
 *
 * Legacy `/c/{slug}` keeps working and canonicals to `/{slug}`.
 */

export type ActivityDomainService = {
  name: string;
  description: string | null;
  duration_minutes: number | null;
  turnaround_hours: number | null;
  modality: string | null;
  price: number | null;
  pricing_mode: string | null;
  price_min: number | null;
  price_max: number | null;
  price_note: string | null;
  requires_provider: boolean;
  preparation_instructions: string | null;
  report_policy: string | null;
  delivery_methods: string[];
};

export type ActivityPublicSpace = {
  slug: string;
  clinicId: string;
  activityType: ActivityType;
  name: string;
  logo: string | null;
  description: string | null;
  /** Owner-managed short hero line (public_profile.tagline). */
  tagline: string | null;
  /** Owner-managed long about text (public_profile.about). */
  about: string | null;
  /** Owner-managed hero/cover image URL (public_profile.cover_url). */
  coverUrl: string | null;
  /** Owner-managed social links (public_profile.social_links). */
  socialLinks: { facebook?: string; instagram?: string; whatsapp?: string; website?: string };
  /** Owner section visibility toggles (public_profile.sections). */
  sections: Record<string, boolean | undefined>;
  /** Bounded display controls (public_profile.display) — activity-agnostic,
   *  renderer maps enums to approved Tailwind classes (no raw CSS passthrough). */
  display: {
    body_text: 'small' | 'medium' | 'large';
    heading: 'small' | 'medium' | 'large';
    section_title: 'small' | 'medium' | 'large';
    image_size: 'small' | 'medium' | 'large';
    video_size: 'small' | 'medium' | 'large';
    gallery_spacing: 'compact' | 'normal' | 'roomy';
  };
  /** Enabled owner-uploaded public gallery items (clinic_public_media). */
  media: {
    id: string;
    media_type: 'image' | 'video';
    public_url: string;
    title: string | null;
    caption: string | null;
    alt_text: string | null;
  }[];
  /** PHASE L — bounded theme (hex colors/enums; renderer maps to safe classes). */
  theme: PublicThemeSettings;
  /** PHASE L — owner-managed public content (enabled rows only). */
  achievements: { id: string; title: string; value: string; icon: string | null; background_color: string; font_size: string }[];
  testimonials: { id: string; patient_name: string; content: string; rating: number; image_url: string | null }[];
  articles: { id: string; title: string; category: string | null; image_url: string | null; published_at: string | null }[];
  news: { id: string; text: string; link: string | null; speed: string; background_color: string; text_color: string }[];
  city: string | null;
  area: string | null;
  address: string | null;
  phone: string | null;
  bookingUrl: string;
  chatUrl: string;
  pageUrl: string;
  legacyPageUrl: string;
  /** Shared clinic-scoped catalog (graceful: empty for imaging/lab without one). */
  services: { name: string; description: string | null; duration_minutes: number | null; price: number | null }[];
  /** Public providers (name/title/specialty only). */
  providers: { name: string; title: string | null; specialty: string | null }[];
  /** Active announcements/offers (clinic_ads, date-windowed). */
  ads: { title: string; description: string | null; image_url: string | null; cta_text: string; cta_link: string | null }[];
  /** Opaque stable public id — QR target /q/{public_id} survives slug changes. */
  publicId: string | null;
  workingHours: { weekday: number; start_time: string; end_time: string }[];
  /** Imaging-specific domain catalog (additive, tenant-scoped). */
  imagingServices: ActivityDomainService[];
  /** Dental-lab-specific domain catalog (additive, tenant-scoped). */
  labServices: ActivityDomainService[];
};

export function activitySpaceUrl(
  slug: string,
  env: Record<string, string | undefined> = process.env
): string {
  const base = getAppBaseUrl(env);
  return `${base}/${encodeURIComponent(slug)}`;
}

/** Resolves only the authoritative activity type for a tenant slug. */
export async function getTenantActivityType(slug: string): Promise<ActivityType | null> {
  const clinic = await resolvePublicClinic({ slug });
  if (!clinic) return null;
  const { data } = await supabaseAdmin
    .from('clinics')
    .select('activity_type')
    .eq('id', clinic.id)
    .is('deleted_at', null)
    .maybeSingle();
  return normalizeActivityType(data?.activity_type ?? 'clinic');
}

async function readDomainCatalog(
  clinicId: string,
  table: 'imaging_services' | 'lab_services'
): Promise<ActivityDomainService[]> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('name, description, duration_minutes, turnaround_hours, modality, price, pricing_mode, price_min, price_max, price_note, requires_provider, preparation_instructions, report_policy, delivery_methods')
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({
    name: s.name,
    description: s.description ?? null,
    duration_minutes: s.duration_minutes ?? null,
    turnaround_hours: s.turnaround_hours ?? null,
    modality: s.modality ?? null,
    price: s.price ?? null,
    pricing_mode: s.pricing_mode ?? null,
    price_min: s.price_min != null ? Number(s.price_min) : null,
    price_max: s.price_max != null ? Number(s.price_max) : null,
    price_note: s.price_note ?? null,
    requires_provider: s.requires_provider !== false,
    preparation_instructions: s.preparation_instructions ?? null,
    report_policy: s.report_policy ?? null,
    delivery_methods: Array.isArray(s.delivery_methods) ? (s.delivery_methods as string[]) : [],
  }));
}

/**
 * Resolves the full activity public space for a tenant slug.
 * Returns null when the tenant does not exist / is soft-deleted.
 * Shares the deny-by-default clinic public projection; domain catalogs are
 * additive and tenant-scoped. No private provider/patient data ever exposed.
 */
export async function getActivityPublicSpace(slug: string): Promise<ActivityPublicSpace | null> {
  const clinic = await resolvePublicClinic({ slug });
  if (!clinic) return null;

  const [profile, activityRow] = await Promise.all([
    getPublicClinicProfile({ slug }),
    supabaseAdmin
      .from('clinics')
      .select('activity_type')
      .eq('id', clinic.id)
      .is('deleted_at', null)
      .maybeSingle(),
  ]);
  if (!profile) return null;

  const activityType = normalizeActivityType(activityRow.data?.activity_type ?? 'clinic');

  const [imagingServices, labServices] =
    activityType === 'imaging_center'
      ? [await readDomainCatalog(clinic.id, 'imaging_services'), []]
      : activityType === 'dental_lab'
        ? [[], await readDomainCatalog(clinic.id, 'lab_services')]
        : [[], []];

  // Owner-managed public gallery — enabled rows only (presentation-only).
  const { data: mediaRows } = await supabaseAdmin
    .from('clinic_public_media')
    .select('id, media_type, public_url, title, caption, alt_text')
    .eq('clinic_id', clinic.id)
    .eq('enabled', true)
    .order('display_order', { ascending: true })
    .limit(24);
  const media = (mediaRows ?? []).map((m) => ({
    id: m.id,
    media_type: m.media_type as 'image' | 'video',
    public_url: m.public_url,
    title: m.title ?? null,
    caption: m.caption ?? null,
    alt_text: m.alt_text ?? null,
  }));

  // PHASE L — owner-managed public content (enabled rows only, ordered).)
  const [{ data: achievementRows }, { data: testimonialRows }, { data: articleRows }, { data: newsRows }] = await Promise.all([
    supabaseAdmin.from('clinic_achievements').select('id, title, value, icon, background_color, font_size')
      .eq('clinic_id', clinic.id).eq('enabled', true).order('display_order', { ascending: true }).limit(25),
    supabaseAdmin.from('clinic_testimonials').select('id, patient_name, content, rating, image_url')
      .eq('clinic_id', clinic.id).eq('enabled', true).order('display_order', { ascending: true }).limit(25),
    supabaseAdmin.from('clinic_articles').select('id, title, category, image_url, published_at')
      .eq('clinic_id', clinic.id).eq('enabled', true).order('display_order', { ascending: true }).limit(12),
    supabaseAdmin.from('clinic_news_ticker').select('id, text, link, speed, background_color, text_color')
      .eq('clinic_id', clinic.id).eq('enabled', true).order('priority', { ascending: true }).limit(20),
  ]);
  const achievements = (achievementRows ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    value: a.value ?? '',
    icon: a.icon ?? null,
    background_color: a.background_color ?? '#0e7490',
    font_size: a.font_size ?? 'medium',
  }));
  const testimonials = (testimonialRows ?? []).map((t) => ({
    id: t.id,
    patient_name: t.patient_name,
    content: t.content,
    rating: t.rating != null ? Number(t.rating) : 5,
    image_url: t.image_url ?? null,
  }));
  const articles = (articleRows ?? []).map((art) => ({
    id: art.id,
    title: art.title,
    category: art.category ?? null,
    image_url: art.image_url ?? null,
    published_at: art.published_at ?? null,
  }));
  const news = (newsRows ?? []).map((n) => ({
    id: n.id,
    text: n.text,
    link: n.link ?? null,
    speed: n.speed ?? 'medium',
    background_color: n.background_color ?? '#0e7490',
    text_color: n.text_color ?? '#ffffff',
  }));

  return {
    slug: profile.slug,
    clinicId: clinic.id,
    activityType,
    name: profile.name,
    logo: profile.logo,
    description: profile.description,
    tagline: profile.tagline ?? null,
    about: profile.about ?? null,
    coverUrl: profile.cover_url ?? null,
    socialLinks: profile.social_links ?? {},
    sections: profile.sections ?? {},
    city: profile.city,
    area: profile.area,
    address: profile.address,
    phone: profile.phone,
    bookingUrl: profile.bookingUrl,
    chatUrl: profile.chatUrl,
    pageUrl: activitySpaceUrl(profile.slug),
    legacyPageUrl: profile.pageUrl,
    services: profile.services,
    providers: profile.providers,
    ads: profile.ads,
    publicId: profile.public_id,
    workingHours: profile.workingHours,
    imagingServices,
    labServices,
    display: profile.display,
    theme: profile.theme,
    media,
    achievements,
    testimonials,
    articles,
    news,
  };
}

// ---------------------------------------------------------------------------
// Discovery / SEO — activity-space entries (Phase C generalization).
// PP-8 foundations preserved: discovery opt-in flag + active subscription.
// entity_kind evolves beyond 'doctor' to the three official activity domains.
// ---------------------------------------------------------------------------

export type ActivitySpaceSeoEntry = {
  kind: ActivityType;
  slug: string;
  name: string;
  city: string | null;
  area: string | null;
};

type SpaceRow = {
  id: string;
  slug: string;
  name: string;
  activity_type: ActivityType;
  city: string | null;
  area: string | null;
  settings: unknown;
};

function readDiscoveryFlag(settings: unknown): boolean {
  const s = (settings ?? {}) as { public_profile?: { discovery_enabled?: unknown } | null };
  return s.public_profile?.discovery_enabled === true;
}

/** Public spaces eligible for Discovery/sitemap (opt-in + active subscription). */
export async function getActivitySpaceEntries(): Promise<ActivitySpaceSeoEntry[]> {
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('id, slug, name, activity_type, city, area, settings')
    .is('deleted_at', null)
    .limit(400);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as SpaceRow[];
  const clinicIds = rows.map((r) => r.id);
  const subscribed = new Set<string>();
  if (clinicIds.length > 0) {
    const { data: subRows } = await supabaseAdmin
      .from('subscriptions')
      .select('clinic_id, status')
      .in('clinic_id', clinicIds)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });
    const latest = new Map<string, string>();
    for (const s of (subRows ?? []) as { clinic_id: string; status: string }[]) {
      if (!latest.has(s.clinic_id)) latest.set(s.clinic_id, s.status);
    }
    for (const [cid, status] of Array.from(latest.entries())) {
      if (status === 'active' || status === 'trialing') subscribed.add(cid);
    }
  }

  return rows
    .filter((r) => subscribed.has(r.id) && readDiscoveryFlag(r.settings))
    .map((r) => ({
      kind: normalizeActivityType(r.activity_type),
      slug: r.slug,
      name: r.name,
      city: r.city ?? null,
      area: r.area ?? null,
    }));
}