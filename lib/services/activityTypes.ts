/**
 * Digital Healthcare Space — authoritative activity types (Phase A).
 *
 * The platform has EXACTLY THREE activity types. There is NO generic
 * "medical lab". These are genuinely different product/business domains.
 * `clinics.activity_type` (strict enum) is the single authoritative
 * discriminator — `settings.clinic_type` free text is legacy/display only.
 */

export const ACTIVITY_TYPES = ['clinic', 'imaging_center', 'dental_lab'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS_AR: Record<ActivityType, string> = {
  clinic: 'عيادة / طبيب أسنان',
  imaging_center: 'مركز أشعة / تصوير',
  dental_lab: 'مختبر أسنان / فني أسنان',
};

export const ACTIVITY_TYPE_LABELS_EN: Record<ActivityType, string> = {
  clinic: 'Clinic / Doctor',
  imaging_center: 'Imaging / Radiology Center',
  dental_lab: 'Dental Lab / Technician',
};

export const ACTIVITY_TYPE_LABELS_FR: Record<ActivityType, string> = {
  clinic: 'Clinique / Dentiste',
  imaging_center: "Centre d'imagerie / Radiologie",
  dental_lab: 'Laboratoire dentaire / Prothésiste',
};

export function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function normalizeActivityType(value: unknown): ActivityType {
  return isActivityType(value) ? value : 'clinic';
}

/**
 * Reserved top-level slugs that can never be a tenant public space path.
 * Next.js static routes take precedence over a root dynamic `[slug]`, so a
 * tenant slug colliding with a static route would be unreachable at /{slug}.
 * Registration validates against this list; legacy `/c/{slug}` still resolves
 * those (rare) legacy tenants safely.
 */
export const RESERVED_PUBLIC_SLUGS = new Set([
  'api',
  'auth',
  'dashboard',
  'book',
  'chat',
  'c',
  'd',
  'discover',
  'demo',
  'portal',
  'q',
  'receptionist',
  'setup',
  'login',
  'register',
  'robots.txt',
  'sitemap.xml',
  'error',
  'not-found',
  'favicon.ico',
]);
