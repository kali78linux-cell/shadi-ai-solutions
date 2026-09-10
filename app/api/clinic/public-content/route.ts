/**
 * PHASE L — PUBLIC PAGE CONTENT management API.
 * GET  ?type=achievements|testimonials|articles|news — list tenant content (DATA_ROLES).
 * POST {type, ...fields} — create tenant content (ADMIN_ROLES).
 * All writes are validated by validateContentInput (bounded hex/enums/lengths)
 * and tenant-scoped AFTER authorizeClinicRequest.
 */
import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import {
  listPublicContent,
  createPublicContent,
  type PublicContentType,
} from '@/lib/services/clinicPublicContent';

const CONTENT_TYPES: readonly string[] = ['achievements', 'testimonials', 'articles', 'news'];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    const type = url.searchParams.get('type') as PublicContentType | null;
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });
    if (!type || !CONTENT_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type must be one of achievements|testimonials|articles|news' }, { status: 400 });
    }
    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized || roleDenied(authorization, DATA_ROLES)) {
      return NextResponse.json(
        { error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: authorization.status }
      );
    }
    const items = await listPublicContent(clinicId, type);
    return NextResponse.json({ data: items });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_content_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
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
    const type = body?.type as PublicContentType | undefined;
    if (!type || !CONTENT_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type must be one of achievements|testimonials|articles|news' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'payload must be an object' }, { status: 400 });
    }

    const result = await createPublicContent(clinicId, type, body);
    if ('message' in result) return NextResponse.json({ error: result.message }, { status: 400 });

    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: `clinic.public_content.create.${type}`,
      resourceType: 'clinic',
      resourceId: clinicId,
    });

    return NextResponse.json({ data: result.item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_content_create_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
