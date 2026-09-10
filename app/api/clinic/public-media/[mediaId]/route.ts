import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  authorizeClinicRequest,
  roleDenied,
  ADMIN_ROLES,
} from '@/lib/services/clinicAuthorization';
import {
  updateClinicMedia,
  deleteClinicMedia,
} from '@/lib/services/clinicPublicMedia';
import { writeAuditLog } from '@/lib/services/auditService';

const patchSchema = z.object({
  title: z.string().trim().max(120).nullable().optional(),
  caption: z.string().trim().max(500).nullable().optional(),
  alt_text: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  display_order: z.number().int().min(0).max(999).optional(),
});

type Ctx = { params: { mediaId: string } };

/** PATCH /api/clinic/public-media/[mediaId] — owner updates metadata / order / visibility. */
export async function PATCH(req: Request, { params }: Ctx) {
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

    const result = await updateClinicMedia(clinicId, params.mediaId, parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.message === 'Media not found' ? 404 : 400 });

    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: 'clinic.public_media.update',
      resourceType: 'clinic',
      resourceId: clinicId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal error', message }, { status: 500 });
  }
}

/** DELETE /api/clinic/public-media/[mediaId] — owner removes object + metadata row. */
export async function DELETE(req: Request, { params }: Ctx) {
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

    const result = await deleteClinicMedia(clinicId, params.mediaId);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.message === 'Media not found' ? 404 : 400 });

    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: 'clinic.public_media.delete',
      resourceType: 'clinic',
      resourceId: clinicId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'Internal error', message }, { status: 500 });
  }
}