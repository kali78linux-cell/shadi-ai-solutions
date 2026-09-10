/**
 * CLINIC PUBLIC PAGE OWNER EXPERIENCE — public page configuration service.
 *
 * The owner manages their clinic's public page WITHOUT a new table: every
 * setting lives in `clinics.settings.public_profile` (JSONB, additive — no
 * migration). Public visibility is STRICTLY SEPARATE from booking eligibility:
 * hiding a service/provider on the public page never removes its
 * clinic_services / provider_services rows or its booking logic.
 *
 * Default ready-made templates are per-activity so a new subscriber gets a
 * sensible, honest page even before customizing anything.
 *
 * Tenant isolation: every read/write is keyed by clinicId resolved server-side
 * by the caller AFTER authorizeClinicRequest. Never trusted from client input.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { normalizeActivityType, type ActivityType } from '@/lib/services/activityTypes';

export type PublicSectionKey =
  | 'hero'
  | 'about'
  | 'services'
  | 'providers'
  | 'hours'
  | 'offers'
  | 'gallery'
  | 'contact'
  | 'bookingCta'
  | 'aiCta'
  | 'qrShare'
  | 'achievements'
  | 'testimonials'
  | 'articles'
  | 'news';

export type SocialLinks = {
  facebook?: string;
  instagram?: string;
  whatsapp?: string;
  website?: string;
};

/**
 * Display controls — BOUNDED enum values only. The dashboard never stores raw
 * CSS; the renderer maps these to approved Tailwind classes, so there is no
 * CSS-injection surface. `media` sizes govern the public gallery.
 */
export type DisplaySize = 'small' | 'medium' | 'large';
export type DisplaySpacing = 'compact' | 'normal' | 'roomy';

export type PublicDisplaySettings = {
  body_text: DisplaySize;
  heading: DisplaySize;
  section_title: DisplaySize;
  image_size: DisplaySize;
  video_size: DisplaySize;
  gallery_spacing: DisplaySpacing;
};

export const DEFAULT_DISPLAY: PublicDisplaySettings = {
  body_text: 'medium',
  heading: 'medium',
  section_title: 'medium',
  image_size: 'medium',
  video_size: 'medium',
  gallery_spacing: 'normal',
};

const DISPLAY_ALLOWED: Record<keyof PublicDisplaySettings, readonly string[]> = {
  body_text: ['small', 'medium', 'large'],
  heading: ['small', 'medium', 'large'],
  section_title: ['small', 'medium', 'large'],
  image_size: ['small', 'medium', 'large'],
  video_size: ['small', 'medium', 'large'],
  gallery_spacing: ['compact', 'normal', 'roomy'],
};

/** Validate a display patch: unknown keys and out-of-range values are rejected (never coerced). */
export function validateDisplayPatch(input: unknown): { ok: true; value: Partial<PublicDisplaySettings> } | { ok: false; message: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'display must be an object' };
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in DISPLAY_ALLOWED)) return { ok: false, message: `unknown display key: ${k}` };
    const allowed = DISPLAY_ALLOWED[k as keyof PublicDisplaySettings];
    if (typeof v !== 'string' || !allowed.includes(v)) {
      return { ok: false, message: `invalid value for display.${k}` };
    }
    out[k] = v;
  }
  return { ok: true, value: out as Partial<PublicDisplaySettings> };
}

/** Read stored display settings, falling back to safe defaults for anything missing/invalid. */
export function readDisplaySettings(settings: unknown): PublicDisplaySettings {
  const raw = (settings ?? {}) as { public_profile?: { display?: Record<string, unknown> } | null };
  const d = (raw.public_profile?.display ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_DISPLAY };
  for (const k of Object.keys(DISPLAY_ALLOWED) as (keyof PublicDisplaySettings)[]) {
    const v = d[k];
    if (typeof v === 'string' && DISPLAY_ALLOWED[k].includes(v)) {
      (out as Record<string, string>)[k] = v;
    }
  }
  return out;
}

/**
 * PHASE L — Bounded public-page theme. Colors are strictly-validated hex
 * strings (React inline styles only — never injected as raw CSS), and
 * shape/size/shadow/zoom map to approved renderer classes. Every value is an
 * enum-safe binding so there is no CSS-injection surface.
 */
export type ButtonShape = 'pill' | 'rounded' | 'squared';
export type PublicThemeSettings = {
  primary_color: string;
  background_color: string;
  text_color: string;
  button_shape: ButtonShape;
  button_size: 'small' | 'medium' | 'large';
  button_shadow: boolean;
  button_zoom: boolean;
};

export const DEFAULT_THEME: PublicThemeSettings = {
  primary_color: '#0e7490',
  background_color: '#f6f8ff',
  text_color: '#0f172a',
  button_shape: 'pill',
  button_size: 'medium',
  button_shadow: true,
  button_zoom: true,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const BUTTON_SHAPES: readonly string[] = ['pill', 'rounded', 'squared'];
const BUTTON_SIZES: readonly string[] = ['small', 'medium', 'large'];

/** Validate a hex color value (bounded — no free-form CSS). */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

/** Validate a theme patch: unknown keys/values are rejected, never coerced. */
export function validateThemePatch(
  input: unknown
): { ok: true; value: Partial<PublicThemeSettings> } | { ok: false; message: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'theme must be an object' };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    switch (k) {
      case 'primary_color':
      case 'background_color':
      case 'text_color':
        if (!isHexColor(v)) return { ok: false, message: `theme.${k} must be a #rrggbb hex color` };
        out[k] = v;
        break;
      case 'button_shape':
        if (typeof v !== 'string' || !BUTTON_SHAPES.includes(v)) return { ok: false, message: 'theme.button_shape must be one of pill|rounded|squared' };
        out[k] = v;
        break;
      case 'button_size':
        if (typeof v !== 'string' || !BUTTON_SIZES.includes(v)) return { ok: false, message: 'theme.button_size must be one of small|medium|large' };
        out[k] = v;
        break;
      case 'button_shadow':
      case 'button_zoom':
        if (typeof v !== 'boolean') return { ok: false, message: `theme.${k} must be a boolean` };
        out[k] = v;
        break;
      default:
        return { ok: false, message: `unknown theme key: ${k}` };
    }
  }
  return { ok: true, value: out as Partial<PublicThemeSettings> };
}

/** Read stored theme with safe defaults for anything missing/invalid. */
export function readTheme(settings: unknown): PublicThemeSettings {
  const raw = (settings ?? {}) as { public_profile?: { theme?: Record<string, unknown> } | null };
  const t = raw.public_profile?.theme ?? {};
  const out = { ...DEFAULT_THEME };
  for (const [k, v] of Object.entries(t)) {
    switch (k) {
      case 'primary_color':
      case 'background_color':
      case 'text_color':
        if (isHexColor(v)) out[k] = v;
        break;
      case 'button_shape':
        if (typeof v === 'string' && BUTTON_SHAPES.includes(v)) out.button_shape = v as ButtonShape;
        break;
      case 'button_size':
        if (typeof v === 'string' && BUTTON_SIZES.includes(v)) out.button_size = v as PublicThemeSettings['button_size'];
        break;
      case 'button_shadow':
      case 'button_zoom':
        if (typeof v === 'boolean') out[k] = v;
        break;
    }
  }
  return out;
}

export type PublicProfileSettings = {
  description?: string;
  tagline?: string;
  about?: string;
  cover_url?: string;
  show_phone?: boolean;
  show_prices?: boolean;
  social_links?: SocialLinks;
  show_providers?: boolean;
  sections?: Partial<Record<PublicSectionKey, boolean>>;
  hidden_services?: string[];
  hidden_providers?: string[];
  display?: Partial<PublicDisplaySettings>;
  theme?: Partial<PublicThemeSettings>;
  discovery_enabled?: boolean;
};

export type PublicPageConfig = PublicProfileSettings & {
  slug: string;
  public_id: string | null;
  pageUrl: string;
  services: { id: string; name: string }[];
  providers: { id: string; name: string; title: string | null; specialty: string | null }[];
  hasAds: boolean;
};

/**
 * Default section layout per activity — the ready-made template for new
 * subscribers. New clinics get this template automatically (no DB editing).
 */
export function defaultPublicPageSections(activityType: ActivityType): Record<PublicSectionKey, boolean> {
  switch (activityType) {
    case 'imaging_center':
      return {
        hero: true, about: true, services: true, providers: false, hours: true,
        offers: false, gallery: false, contact: true, bookingCta: true, aiCta: true, qrShare: true,
        achievements: false, testimonials: false, articles: false, news: false,
      };
    case 'dental_lab':
      return {
        hero: true, about: true, services: true, providers: false, hours: true,
        offers: false, gallery: false, contact: true, bookingCta: true, aiCta: true, qrShare: true,
        achievements: false, testimonials: false, articles: false, news: false,
      };
    default:
      return {
        hero: true, about: true, services: true, providers: true, hours: true,
        offers: true, gallery: false, contact: true, bookingCta: true, aiCta: true, qrShare: true,
        achievements: false, testimonials: false, articles: false, news: false,
      };
  }
}

/** Read the public_profile blob, falling back to the activity default template. */
export function readPublicProfile(settings: unknown, activityType: ActivityType): PublicProfileSettings {
  const raw = (settings ?? {}) as { public_profile?: Record<string, unknown> | null };
  const p = (raw.public_profile ?? {}) as Record<string, unknown>;
  const defaults = defaultPublicPageSections(activityType);
  const stored = (p.sections ?? {}) as Record<string, unknown>;
  return {
    description: typeof p.description === 'string' ? p.description : undefined,
    tagline: typeof p.tagline === 'string' ? p.tagline : undefined,
    about: typeof p.about === 'string' ? p.about : undefined,
    cover_url: typeof p.cover_url === 'string' ? p.cover_url : undefined,
    show_phone: p.show_phone === true,
    show_prices: p.show_prices === true,
    show_providers: p.show_providers !== false,
    discovery_enabled: p.discovery_enabled === true,
    social_links: (p.social_links ?? {}) as SocialLinks,
    sections: { ...defaults, ...((p.sections ?? {}) as Record<string, unknown>) },
    hidden_services: Array.isArray(p.hidden_services) ? p.hidden_services.map(String) : [],
    hidden_providers: Array.isArray(p.hidden_providers) ? p.hidden_providers.map(String) : [],
    display: readDisplaySettings(settings),
    theme: readTheme(settings),
  };
}

/** Tenant-scoped read for the owner screen (includes what to toggle). */
export async function getPublicPageConfig(clinicId: string): Promise<PublicPageConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('id, slug, public_id, settings, activity_type')
    .eq('id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data) {
    if (error) logEvent('public_config_get_error', { clinicId, error: error.message }, 'error');
    return null;
  }
  const activityType = normalizeActivityType(data.activity_type ?? 'clinic');
  const config = readPublicProfile(data.settings, activityType);

  const [{ data: services }, { data: providers }, { data: ads }] = await Promise.all([
    supabaseAdmin
      .from('clinic_services')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .is('deleted_at', null),
    supabaseAdmin
      .from('providers')
      .select('id, name, title, specialty')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('clinic_ads')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(1),
  ]);

  return {
    ...config,
    slug: data.slug,
    public_id: data.public_id ?? null,
    pageUrl: `/${encodeURIComponent(data.slug)}`,
    services: (services ?? []).map((s) => ({ id: s.id, name: s.name })),
    providers: (providers ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title ?? null,
      specialty: p.specialty ?? null,
    })),
    hasAds: (ads?.length ?? 0) > 0,
  };
}

/**
 * Tenant-scoped update of the public page configuration. Writes only into
 * clinics.settings.public_profile JSONB (additive — no schema change).
 * Validation + tenant isolation must happen before calling this.
 */
export async function updatePublicPageConfig(
  clinicId: string,
  patch: Partial<PublicProfileSettings>
): Promise<{ ok: boolean; message?: string }> {
  const { data: current, error: readError } = await supabaseAdmin
    .from('clinics')
    .select('settings, activity_type')
    .eq('id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError || !current) {
    logEvent('public_config_find_error', { clinicId, error: readError?.message ?? 'not found' }, 'error');
    return { ok: false, message: 'Clinic not found' };
  }

  const settings = { ...(current.settings ?? {}) };
  const existing = (settings.public_profile ?? {}) as Record<string, unknown>;
  const activityType = normalizeActivityType(current.activity_type ?? 'clinic');

  const updated: Record<string, unknown> = { ...existing };

  // Scalar/profile fields (with empty-string → delete so users can clear them).
  const scalarFields: (keyof PublicProfileSettings)[] = [
    'description', 'tagline', 'about', 'cover_url',
    'show_phone', 'show_prices', 'show_providers', 'discovery_enabled',
  ];
  for (const key of scalarFields) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === '' || v === null) delete updated[key];
    else updated[key] = v;
  }

  // social_links — merge only provided keys; empty strings mean delete a link.
  if (patch.social_links !== undefined) {
    const base = (existing.social_links ?? {}) as Record<string, unknown>;
    const merged = { ...base };
    for (const [k, v] of Object.entries(patch.social_links)) {
      if (v === '' || v === null || v === undefined) delete merged[k];
      else merged[k] = v;
    }
    updated.social_links = merged;
  }

  // sections — merge with the activity-aware defaults.
  if (patch.sections !== undefined) {
    const defaults = defaultPublicPageSections(activityType);
    const base = (existing.sections ?? {}) as Record<string, unknown>;
    const merged = { ...defaults, ...base };
    for (const [k, v] of Object.entries(patch.sections)) {
      if (typeof v === 'boolean') merged[k] = v;
    }
    updated.sections = merged;
  }

  // hidden services/providers — replace whole arrays whenever provided.
  if (Array.isArray(patch.hidden_services)) {
    updated.hidden_services = patch.hidden_services.map(String);
  }
  if (Array.isArray(patch.hidden_providers)) {
    updated.hidden_providers = patch.hidden_providers.map(String);
  }

  // display controls — strictly validated bounded enums; reject the whole
  // patch on any unknown key/value (no silent coercion, no CSS passthrough).
  if (patch.display !== undefined) {
    const validatedDisplay = validateDisplayPatch(patch.display);
    if ('value' in validatedDisplay) {
      const base = (existing.display ?? {}) as Record<string, unknown>;
      updated.display = { ...base, ...validatedDisplay.value };
    } else {
      return { ok: false, message: validatedDisplay.message };
    }
  }

  // theme — strictly validated bounded values; reject the whole patch on
  // any unknown key/value (no silent coercion, hex only, no CSS passthrough).
  if (patch.theme !== undefined) {
    const validatedTheme = validateThemePatch(patch.theme);
    if ('value' in validatedTheme) {
      const base = (existing.theme ?? {}) as Record<string, unknown>;
      updated.theme = { ...base, ...validatedTheme.value };
    } else {
      return { ok: false, message: validatedTheme.message };
    }
  }

  settings.public_profile = updated;

  const { data, error } = await supabaseAdmin
    .from('clinics')
    .update({ settings })
    .eq('id', clinicId)
    .is('deleted_at', null)
    .select('id, slug')
    .single();

  if (error || !data) {
    logEvent('public_config_save_error', { clinicId, error: error?.message ?? 'no row' }, 'error');
    return { ok: false, message: 'Failed to save public page configuration' };
  }

  logEvent('public_config_saved', { clinic_id: clinicId });
  return { ok: true };
}