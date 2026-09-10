/**
 * PP-8A — Provider Visibility Foundation (server-only).
 *
 * Owns the deny-by-default public visibility state introduced by
 * docs/pp8-product-ux-spec.md (Revision 2):
 *
 *   - Clinic-level Discovery opt-in: clinics.settings.public_profile.discovery_enabled
 *     (JSONB flag — absence/false = NOT discoverable). Governs Discovery
 *     eligibility ONLY; it never touches /c/[slug], clinicPublicProfile,
 *     resolvePublicClinic, /book or /chat (15D behavior is untouched).
 *   - Provider-level visibility: providers.public_visibility
 *     ('private' | 'noindex' | 'indexable'; DB default 'private').
 *
 * Consumers of this state (public doctor pages, /discover, sitemap) do NOT
 * exist in PP-8A — this is foundation-only. Nothing here makes any provider
 * or clinic publicly visible by itself.
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const PROVIDER_VISIBILITY_VALUES = ['private', 'noindex', 'indexable'] as const;
export type ProviderVisibility = (typeof PROVIDER_VISIBILITY_VALUES)[number];

/**
 * Owner-approved publishable provider types (PP-8B, 2026-09-02).
 * Private identities — staff/receptionist/assistant/manager — can never be
 * published (spec §8.1), enforced deny-at-write.
 */
export const PUBLISHABLE_PROVIDER_TYPES = ['dentist', 'specialist', 'hygienist'] as const;

type ClinicSettingsShape = {
  public_profile?: {
    discovery_enabled?: unknown;
    description?: unknown;
  } | null;
};

function readFlag(value: unknown): boolean {
  return value === true;
}

export type ProviderVisibilityRow = {
  id: string;
  name: string;
  provider_type: string;
  public_visibility: ProviderVisibility;
  public_slug: string | null;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
  deleted_at: string | null;
};

export type PublicVisibilityState = {
  clinic: { discovery_enabled: boolean };
  providers: ProviderVisibilityRow[];
};

/**
 * Reads the full visibility state for one clinic.
 * Returns null when the clinic does not exist or is soft-deleted.
 * Deny-by-default: a missing/absent flag reads as false / 'private'.
 */
export async function getPublicVisibilityState(
  clinicId: string
): Promise<PublicVisibilityState | null> {
  const { data: clinicRow, error: clinicError } = await supabaseAdmin
    .from('clinics')
    .select('settings')
    .eq('id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (clinicError) throw new Error(clinicError.message);
  if (!clinicRow) return null;

  const settings = (clinicRow.settings ?? {}) as ClinicSettingsShape;
  const discovery_enabled = readFlag(settings.public_profile?.discovery_enabled);

  const { data: providerRows, error: providersError } = await supabaseAdmin
    .from('providers')
    .select(
      'id, name, provider_type, public_visibility, public_slug, specialty, bio, photo_url, deleted_at'
    )
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .order('name', { ascending: true });
  if (providersError) throw new Error(providersError.message);

  return {
    clinic: { discovery_enabled },
    providers: (providerRows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      provider_type: p.provider_type,
      public_visibility: p.public_visibility as ProviderVisibility,
      public_slug: p.public_slug ?? null,
      specialty: p.specialty ?? null,
      bio: p.bio ?? null,
      photo_url: p.photo_url ?? null,
      deleted_at: p.deleted_at,
    })),
  };
}

/**
 * Sets/clears the clinic-level Discovery opt-in flag.
 * Absence of the flag = false (deny-by-default), mirroring the 15D readFlag
 * convention. Only touches settings.public_profile — no other key is modified.
 * Throws 'CLINIC_NOT_FOUND' when the clinic does not exist / is soft-deleted.
 */
export async function setClinicDiscoveryEnabled(
  clinicId: string,
  enabled: boolean
): Promise<boolean> {
  const { data: current, error: readError } = await supabaseAdmin
    .from('clinics')
    .select('settings')
    .eq('id', clinicId)
    .is('deleted_at', null)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!current) throw new Error('CLINIC_NOT_FOUND');

  const settings = { ...((current.settings ?? {}) as Record<string, unknown>) };
  const publicProfile = {
    ...((settings.public_profile ?? {}) as Record<string, unknown>),
  };
  if (enabled) {
    publicProfile.discovery_enabled = true;
  } else {
    delete publicProfile.discovery_enabled;
  }
  settings.public_profile = publicProfile;

  const { error } = await supabaseAdmin
    .from('clinics')
    .update({ settings })
    .eq('id', clinicId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);
  return enabled;
}

/**
 * Sets the visibility of ONE provider, strictly scoped by (clinic_id, id).
 * Returns null when the provider does not exist in this clinic (cross-tenant
 * or unknown id) — callers must answer 404, never leak existence elsewhere.
 * Throws 'PROVIDER_NOT_PUBLISHABLE' when the target is a staff identity:
 * private staff identities must never become publicly visible
 * (spec §8.1 — enforcement at write time, defense in depth for PP-8B+).
 */
export async function setProviderVisibility(
  clinicId: string,
  providerId: string,
  visibility: ProviderVisibility
): Promise<ProviderVisibilityRow | null> {
  const { data: existing, error: readError } = await supabaseAdmin
    .from('providers')
    .select('id, name, provider_type, deleted_at')
    .eq('id', providerId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing || existing.deleted_at) return null;
  if (
    !PUBLISHABLE_PROVIDER_TYPES.includes(
      existing.provider_type as (typeof PUBLISHABLE_PROVIDER_TYPES)[number]
    )
  ) {
    throw new Error('PROVIDER_NOT_PUBLISHABLE');
  }

  const { data, error } = await supabaseAdmin
    .from('providers')
    .update({ public_visibility: visibility })
    .eq('id', providerId)
    .eq('clinic_id', clinicId)
    .select(
      'id, name, provider_type, public_visibility, public_slug, specialty, bio, photo_url, deleted_at'
    )
    .single();
  if (error) throw new Error(error.message);

  return {
    id: data.id,
    name: data.name,
    provider_type: data.provider_type,
    public_visibility: data.public_visibility as ProviderVisibility,
    public_slug: data.public_slug ?? null,
    specialty: data.specialty ?? null,
    bio: data.bio ?? null,
    photo_url: data.photo_url ?? null,
    deleted_at: data.deleted_at,
  };
}

// ---------------------------------------------------------------------------
// PP-8B-i — Public profile fields + stable public slug (owner-approved)
// ---------------------------------------------------------------------------

export const PUBLIC_PROFILE_FIELD_LIMITS = {
  specialty: 120,
  bio: 2000,
  photo_url: 600,
} as const;

export type ProviderPublicProfileInput = {
  specialty?: string | null;
  bio?: string | null;
  photo_url?: string | null;
};

/** Opaque, stable public identity: 'dr-' + 12 lowercase hex chars. */
function newPublicSlug(): string {
  return `dr-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function readScopedProvider(
  clinicId: string,
  providerId: string
): Promise<{ id: string; provider_type: string; public_slug: string | null; deleted_at: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('providers')
    .select('id, provider_type, public_slug, deleted_at')
    .eq('id', providerId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.deleted_at) return null;
  return data;
}

function assertPublishable(providerType: string): void {
  if (
    !PUBLISHABLE_PROVIDER_TYPES.includes(
      providerType as (typeof PUBLISHABLE_PROVIDER_TYPES)[number]
    )
  ) {
    throw new Error('PROVIDER_NOT_PUBLISHABLE');
  }
}

/**
 * Returns the provider's stable public slug, generating it EXACTLY once.
 * Generation is reserved: the conditional update (public_slug is null) makes
 * the set-once property race-safe, and the slug is NEVER regenerated —
 * not on rename, not on deactivation/reactivation (owner decision).
 * Returns null for unknown/soft-deleted providers; throws
 * PROVIDER_NOT_PUBLISHABLE for private identities.
 */
export async function ensureProviderSlug(
  clinicId: string,
  providerId: string
): Promise<{ slug: string } | null> {
  const existing = await readScopedProvider(clinicId, providerId);
  if (!existing) return null;
  assertPublishable(existing.provider_type);
  if (existing.public_slug) return { slug: existing.public_slug };

  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = newPublicSlug();
    const { data, error } = await supabaseAdmin
      .from('providers')
      .update({ public_slug: slug })
      .eq('id', providerId)
      .eq('clinic_id', clinicId)
      .is('public_slug', null)
      .select('public_slug')
      .single();
    if (!error && data?.public_slug) return { slug: data.public_slug };
    // Unique collision / concurrent generation → next attempt.
  }
  throw new Error('SLUG_GENERATION_FAILED');
}

/**
 * Updates the public-facing marketing fields of ONE provider, scoped by
 * (clinic_id, id). Publishing types only — private identities are rejected
 * (these fields are meaningless for a non-publishable provider).
 * Throws NOTHING_TO_UPDATE on an empty patch; PROVIDER_NOT_PUBLISHABLE for
 * private identities; returns null for unknown/soft-deleted providers.
 */
export async function updateProviderPublicProfile(
  clinicId: string,
  providerId: string,
  profile: ProviderPublicProfileInput
): Promise<ProviderVisibilityRow | null> {
  const existing = await readScopedProvider(clinicId, providerId);
  if (!existing) return null;
  assertPublishable(existing.provider_type);

  const update: Record<string, unknown> = {};
  if (profile.specialty !== undefined) {
    const v = profile.specialty?.trim();
    update.specialty = v ? v.slice(0, PUBLIC_PROFILE_FIELD_LIMITS.specialty) : null;
  }
  if (profile.bio !== undefined) {
    const v = profile.bio?.trim();
    update.bio = v ? v.slice(0, PUBLIC_PROFILE_FIELD_LIMITS.bio) : null;
  }
  if (profile.photo_url !== undefined) {
    const v = profile.photo_url?.trim();
    update.photo_url = v ? v.slice(0, PUBLIC_PROFILE_FIELD_LIMITS.photo_url) : null;
  }
  if (Object.keys(update).length === 0) throw new Error('NOTHING_TO_UPDATE');

  const { data, error } = await supabaseAdmin
    .from('providers')
    .update(update)
    .eq('id', providerId)
    .eq('clinic_id', clinicId)
    .select(
      'id, name, provider_type, public_visibility, public_slug, specialty, bio, photo_url, deleted_at'
    )
    .single();
  if (error) throw new Error(error.message);

  return {
    id: data.id,
    name: data.name,
    provider_type: data.provider_type,
    public_visibility: data.public_visibility as ProviderVisibility,
    public_slug: data.public_slug ?? null,
    specialty: data.specialty ?? null,
    bio: data.bio ?? null,
    photo_url: data.photo_url ?? null,
    deleted_at: data.deleted_at,
  };
}
