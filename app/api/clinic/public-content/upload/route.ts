/**
 * PHASE L — reusable public-content image upload.
 * POST FormData: file → storage (clinic-public-media / clinic/{clinic_id}/public-content/...) → { path, url }.
 * Reuses the validated media pipeline (MIME + size + ext) from clinicPublicMedia.
 * Non-image content types (PDF/DICOM) are intentionally NOT accepted here — the
 * public page is imagery-only.
 */
import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { logEvent } from '@/lib/server/logging';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateMediaFile, buildMediaStoragePath, mediaPublicUrl, MEDIA_BUCKET } from '@/lib/services/clinicPublicMedia';

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
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const validation = validateMediaFile({ name: file.name, type: file.type, size: file.size });
    if ('message' in validation) return NextResponse.json({ error: validation.message }, { status: 400 });

    // Tenant-isolated path inside the SHARED public-media bucket. The existing
    // storage RLS prefix policy (clinic/{clinic_id}/...) accepts this folder.
    const path = `clinic/${clinicId}/public-content/${randomUUID()}${validation.ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      logEvent('public_content_upload_error', { clinicId, error: uploadError.message }, 'error');
      return NextResponse.json({ error: `تعذر رفع الملف إلى التخزين: ${uploadError.message}` }, { status: 500 });
    }

    return NextResponse.json({ data: { path, url: mediaPublicUrl(path) } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('public_content_upload_catch', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

import { randomUUID } from 'crypto';
