import { NextResponse } from 'next/server';
import { resolvePublicClinic } from '@/lib/services/clinics';
import { clinicQrSvg } from '@/lib/qr/clinicQr';

/**
 * Public QR download endpoint (Public Clinic Page redesign).
 *
 * `GET /api/qr?public_id={publicId}` → SVG QR encoding `/q/{public_id}`.
 * The opaque stable public_id is the QR target (never the slug), so printed
 * codes survive slug changes. Resolution is server-side via resolvePublicClinic
 * (id/slug/publicId accepted — publicId only used here). Returns 404 for
 * unknown/soft-deleted clinics and exposes nothing but the SVG itself.
 * Nothing is stored; generated on demand.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const publicId = url.searchParams.get('public_id')?.trim();
  if (!publicId || publicId.length > 128) {
    return new NextResponse(null, { status: 404 });
  }

  const clinic = await resolvePublicClinic({ publicId });
  if (!clinic) {
    return new NextResponse(null, { status: 404 });
  }

  const svg = await clinicQrSvg({ publicId, slug: clinic.slug });

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
