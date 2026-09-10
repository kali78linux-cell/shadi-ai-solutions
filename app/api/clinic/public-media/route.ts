import { NextResponse } from 'next/server';
import {
  authorizeClinicRequest,
  roleDenied,
  ADMIN_ROLES,
  DATA_ROLES,
} from '@/lib/services/clinicAuthorization';
import { listClinicMedia, createClinicMedia } from '@/lib/services/clinicPublicMedia';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';

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

    const data = await listClinicMedia(clinicId);
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_media_get_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/clinic/public-media — owner upload.
 * multipart/form-data: file (required), title, caption, alt_text.
 * Server-side MIME/size validation + tenant-isolated storage path.
 */
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

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'الملف مطلوب (file)' }, { status: 400 });
    }

    const str = (key: string, max: number) => {
      const raw = form.get(key);
      if (!raw) return undefined;
      const s = String(raw).trim().slice(0, max);
      return s || null;
    };

    const result = await createClinicMedia(clinicId, {
      file,
      title: str('title', 120),
      caption: str('caption', 500),
      alt_text: str('alt_text', 500),
    });
    if (!result.ok) return NextResponse.json({ error: 'message' in result ? result.message : 'Upload failed' }, { status: 400 });

    await writeAuditLog({
      clinicId,
      actorUserId: authorization.user?.id ?? null,
      action: 'clinic.public_media.create',
      resourceType: 'clinic',
      resourceId: clinicId,
    });

    return NextResponse.json({ data: result.item }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_media_upload_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}