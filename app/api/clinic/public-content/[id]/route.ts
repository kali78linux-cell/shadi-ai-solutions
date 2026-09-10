/**
 * PHASE L — PUBLIC PAGE CONTENT item management.
 * PATCH {type, ...patch} — update one tenant content item (ADMIN_ROLES).
 * DELETE ?type= — delete one tenant content item (ADMIN_ROLES).
 * Tenant-scoped by clinic_id + id AFTER authorizeClinicRequest.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import { updatePublicContent, deletePublicContent, type PublicContentType } from '@/lib/services/clinicPublicContent';

const CONTENT_TYPES: readonly string[] = ['achievements', 'testimonials', 'articles', 'news'];
const paramsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    const type = url.searchParams.get('type') as PublicContentType | null;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!type || !CONTENT_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type must be one of achievements|testimonials|articles|news' }, { status: 400 });
    }
    const { id } = paramsSchema.parse(await req.json());

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized || roleDenied(authorization, ADMIN_ROLES)) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }
    const result = await updatePublicContent(clinicId, type, id, jsonToPatch(await req.json()));
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: `clinic.public_content.update.${type}`,
      resourceType: 'clinic',
      resourceId: clinicId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_content_patch_error', { error: message }, 'error');
    if (message.includes('Invalid')) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    const type = url.searchParams.get('type') as PublicContentType | null;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!type || !CONTENT_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type must be one of achievements|testimonials|articles|news' }, { status: 400 });
    }
    const { id } = paramsSchema.parse(await req.json());

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized || roleDenied(authorization, ADMIN_ROLES)) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }
    const result = await deletePublicContent(clinicId, type, id);
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 });
    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: `clinic.public_content.delete.${type}`,
      resourceType: 'clinic',
      resourceId: clinicId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_content_delete_error', { error: message }, 'error');
    return NextResponse.json({ error: message.includes('Invalid') ? 'Invalid id' : 'Internal error' }, { status: message.includes('Invalid') ? 400 : 500 });
  }
}

function jsonToPatch(body: unknown): Record<string, unknown> {
  // PATCH accepts the whole payload; id is consumed above, the rest is the patch.
  const { id: _id, ...rest } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  return rest;
}
