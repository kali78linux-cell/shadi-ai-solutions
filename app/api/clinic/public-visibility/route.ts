/**
 * PP-8A — Public Visibility management API (clinic-scoped).
 *
 * GET   — any clinic member (DATA_ROLES): read the visibility state
 *         (clinic discovery opt-in + per-provider visibility).
 * PATCH — owner/manager only (ADMIN_ROLES): set the clinic Discovery opt-in
 *         and/or the visibility of ONE provider.
 *
 * This endpoint ONLY manages the deny-by-default visibility state
 * (docs/pp8-product-ux-spec.md). No public consumer exists in PP-8A:
 * changing these values does not alter /c/[slug], clinicPublicProfile,
 * resolvePublicClinic, /book or /chat (15D behavior unchanged).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authorizeClinicRequest,
  roleDenied,
  ADMIN_ROLES,
  DATA_ROLES,
} from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import {
  getPublicVisibilityState,
  setClinicDiscoveryEnabled,
  setProviderVisibility,
  ensureProviderSlug,
  updateProviderPublicProfile,
  PROVIDER_VISIBILITY_VALUES,
  type ProviderVisibility,
} from '@/lib/services/providerVisibility';

const patchSchema = z
  .object({
    discovery_enabled: z.boolean().optional(),
    provider_id: z.string().uuid().optional(),
    visibility: z.enum(PROVIDER_VISIBILITY_VALUES).optional(),
    profile: z
      .object({
        specialty: z.string().max(120).nullable().optional(),
        bio: z.string().max(2000).nullable().optional(),
        photo_url: z
          .string()
          .max(600)
          .refine((v) => v === '' || /^https?:\/\//i.test(v), {
            message: 'photo_url must be an http(s) URL',
          })
          .nullable()
          .optional(),
      })
      .optional(),
  })
  .refine(
    (v) =>
      v.discovery_enabled !== undefined ||
      (v.provider_id !== undefined &&
        (v.visibility !== undefined || v.profile !== undefined)),
    { message: 'Nothing to update' }
  )
  .refine((v) => v.profile === undefined || v.provider_id !== undefined, {
    message: 'provider_id is required when profile is provided',
  });

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) {
      return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    }

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }
    const roleGate = roleDenied(authorization, DATA_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const state = await getPublicVisibilityState(clinicId);
    if (!state) {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
    }

    return NextResponse.json({ data: state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_visibility_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) {
      return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    }

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }
    // owner/manager only — staff (and every other role) can never publish.
    const roleGate = roleDenied(authorization, ADMIN_ROLES);
    if (roleGate) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.errors },
        { status: 400 }
      );
    }
    const { discovery_enabled, provider_id, visibility, profile } = parsed.data;

    let clinicDiscoveryEnabled: boolean | undefined;
    let provider: {
      id: string;
      public_visibility: ProviderVisibility;
      public_slug: string | null;
      specialty: string | null;
      bio: string | null;
      photo_url: string | null;
    } | null = null;

    if (provider_id !== undefined && visibility !== undefined) {
      const row = await setProviderVisibility(clinicId, provider_id, visibility);
      if (!row) {
        return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
      }
      provider = {
        id: row.id,
        public_visibility: row.public_visibility,
        public_slug: row.public_slug,
        specialty: row.specialty,
        bio: row.bio,
        photo_url: row.photo_url,
      };
    }
    if (provider_id !== undefined && profile !== undefined) {
      const row = await updateProviderPublicProfile(clinicId, provider_id, profile);
      if (!row) {
        return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
      }
      // Stable slug is generated exactly once — on the first public-presence
      // edit — then never changes (not on rename, not on reactivation).
      const slug = await ensureProviderSlug(clinicId, provider_id);
      provider = {
        id: row.id,
        public_visibility: row.public_visibility,
        public_slug: slug?.slug ?? row.public_slug,
        specialty: row.specialty,
        bio: row.bio,
        photo_url: row.photo_url,
      };
    } else if (provider && visibility !== undefined && visibility !== 'private') {
      // Publishing a provider implies a stable public URL identity.
      const slug = await ensureProviderSlug(clinicId, provider_id!);
      provider = { ...provider, public_slug: slug?.slug ?? provider.public_slug };
    }
    if (discovery_enabled !== undefined) {
      clinicDiscoveryEnabled = await setClinicDiscoveryEnabled(clinicId, discovery_enabled);
    }

    logEvent('public_visibility_updated', {
      clinic_id: clinicId,
      discovery_enabled: clinicDiscoveryEnabled,
      provider_id: provider?.id,
      visibility: provider?.public_visibility,
      profile_updated: profile !== undefined,
    });
    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: 'clinic.public_visibility.update',
      resourceType: provider ? 'provider' : 'clinic',
      resourceId: provider?.id ?? clinicId,
      metadata: {
        discovery_enabled: clinicDiscoveryEnabled,
        visibility: provider?.public_visibility,
        profile_fields: profile ? Object.keys(profile) : undefined,
      },
    });

    return NextResponse.json({
      data: {
        clinic: {
          discovery_enabled:
            clinicDiscoveryEnabled ?? (await getPublicVisibilityState(clinicId))?.clinic.discovery_enabled ?? false,
        },
        provider,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'CLINIC_NOT_FOUND') {
      return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
    }
    if (message === 'PROVIDER_NOT_PUBLISHABLE') {
      return NextResponse.json(
        { error: 'This provider type cannot be publicly visible' },
        { status: 400 }
      );
    }
    if (message === 'NOTHING_TO_UPDATE') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }
    logEvent('public_visibility_patch_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
