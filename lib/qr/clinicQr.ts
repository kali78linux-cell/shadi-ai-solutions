import QRCode from 'qrcode';
import { publicClinicUrl } from '@/lib/services/clinicPublicProfile';

/**
 * STEP 15D — Server-side QR generation for the clinic public page.
 *
 * QR codes encode `/q/{public_id}` (opaque stable identifier) so printed
 * codes keep working even if the clinic slug changes later. Generated
 * on-demand as SVG — nothing is stored.
 */
export async function clinicQrSvg(clinic: { publicId: string; slug: string }): Promise<string> {
  // publicClinicUrl builds the base; swap the /c/{slug} tail for /q/{publicId}.
  const base = publicClinicUrl(clinic.slug);
  const pageUrl = new URL(base);
  const destination = `${pageUrl.origin}/q/${encodeURIComponent(clinic.publicId)}`;

  return QRCode.toString(destination, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 2,
  });
}

/** Returns the exact destination URL a QR code for this clinic encodes. */
export function clinicQrDestination(clinic: { publicId: string; slug: string }): string {
  const pageUrl = new URL(publicClinicUrl(clinic.slug));
  return `${pageUrl.origin}/q/${encodeURIComponent(clinic.publicId)}`;
}
