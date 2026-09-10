/**
 * CLINIC PUBLIC PAGE OWNER EXPERIENCE — public page management API.
 *
 * GET   — any clinic member (DATA_ROLES): the tenant's public page
 *         configuration (settings + togglable services/providers + URLs).
 * PATCH — owner/manager only (ADMIN_ROLES): update the tenant's public page
 *         settings (sections, description, social links, hidden services/providers,…).
 *
 * Everything is keyed by clinic_id AFTER authorizeClinicRequest, so a user can
 * only ever read/write their own clinic's configuration (tenant isolation).
 * These settings strictly control PUBLIC PAge presentation, never booking
 * eligibility. No schema change: clinics.settings.public_profile (JSONB).
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
import { getPublicPageConfig, updatePublicPageConfig } from '@/lib/services/clinicPublicConfig';

const patchSchema = z.object({
  description: z.string().max(3000).nullable().optional(),
  tagline: z.string().max(300).nullable().optional(),
  about: z.string().max(6000).nullable().optional(),
  cover_url: z.string().max(600).nullable().optional(),
  show_phone: z.boolean().optional(),
  show_prices: z.boolean().optional(),
  show_providers: z.boolean().optional(),
  discovery_enabled: z.boolean().optional(),
  social_links: z
    .object({
      facebook: z.string().max(600).nullable().optional(),
      instagram: z.string().max(600).nullable().optional(),
      whatsapp: z.string().max(30).nullable().optional(),
      website: z.string().max(600).nullable().optional(),
    })
    .optional(),
  sections: z.record(z.boolean()).optional(),
  hidden_services: z.array(z.string().uuid()).optional(),
  hidden_providers: z.array(z.string().uuid()).optional(),
  // Bounded display controls — enums only; the service re-validates before saving.
  display: z
    .object({
      body_text: z.enum(['small', 'medium', 'large']).optional(),
      heading: z.enum(['small', 'medium', 'large']).optional(),
      section_title: z.enum(['small', 'medium', 'large']).optional(),
      image_size: z.enum(['small', 'medium', 'large']).optional(),
      video_size: z.enum(['small', 'medium', 'large']).optional(),
      gallery_spacing: z.enum(['compact', 'normal', 'roomy']).optional(),
    })
    .optional(),
  // PHASE L — bounded theme (hex colors + enums only; service re-validates).
  theme: z
    .object({
      primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      button_shape: z.enum(['pill', 'rounded', 'squared']).optional(),
      button_size: z.enum(['small', 'medium', 'large']).optional(),
      button_shadow: z.boolean().optional(),
      button_zoom: z.boolean().optional(),
    })
    .optional(),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized || roleDenied(authorization, DATA_ROLES)) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }

    const config = await getPublicPageConfig(clinicId);
    if (!config) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    return NextResponse.json({ data: config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_page_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized || roleDenied(authorization, ADMIN_ROLES)) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 }
      );
    }

    const result = await updatePublicPageConfig(clinicId, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });

    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: 'clinic.public_page.update',
      resourceType: 'clinic',
      resourceId: clinicId,
    });

    const config = await getPublicPageConfig(clinicId);
    return NextResponse.json({ data: config });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_page_patch_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
