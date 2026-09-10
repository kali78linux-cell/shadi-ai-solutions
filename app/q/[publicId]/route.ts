import { NextResponse } from 'next/server';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { activitySpaceUrl } from '@/lib/services/activityPublicSpace';

/**
 * STEP 15D / Digital Healthcare Space — QR destination route.
 *
 * `/q/{public-id}` redirects (302) to the canonical public space `/{slug}`
 * (activity-aware since Phase E). The public_id remains the opaque, stable
 * identifier (migration 20260832_clinic_public_id) so printed QR codes
 * survive slug changes AND the canonical migration. Exposes nothing but the
 * redirect itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: { publicId: string } }
): Promise<NextResponse> {
  const publicId = params.publicId?.trim();
  if (!publicId || publicId.length > 128) {
    return new NextResponse(null, { status: 404 });
  }

  const clinic = await resolvePublicClinic({ publicId });
  if (!clinic) {
    return new NextResponse(null, { status: 404 });
  }

  const target = activitySpaceUrl(clinic.slug);
  return NextResponse.redirect(new URL(target, _request.url), 302);
}
