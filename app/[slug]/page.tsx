import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getActivityPublicSpace, activitySpaceUrl } from '@/lib/services/activityPublicSpace';
import { ClinicPublicSpace } from '@/components/public/ClinicPublicSpace';
import { ImagingPublicSpace } from '@/components/public/ImagingPublicSpace';
import { DentalLabPublicSpace } from '@/components/public/DentalLabPublicSpace';

/**
 * Digital Healthcare Space — CANONICAL public space route (Phase E).
 *
 *   /{slug}  →  resolve tenant  →  activity_type  →
 *               activity-specific public space (Clinic / Imaging / Dental Lab)
 *
 * Legacy `/c/{slug}` remains a compatibility route (no longer canonical):
 * it renders the same tenant but with canonical → /{slug} + robots noindex,
 * so the canonical identity consolidates here without breaking existing links.
 *
 * Shared tenant identity (clinics.activity_type) is the single discriminator.
 * Domain catalogs (imaging_services/lab_services) are additive & tenant-scoped.
 */

export const dynamic = 'force-dynamic';

export type ActivitySpacePageProps = { params: { slug: string } };

export async function generateMetadata({ params }: ActivitySpacePageProps): Promise<Metadata> {
  const space = await getActivityPublicSpace(params.slug);
  if (!space) {
    return { title: 'غير موجودة', robots: { index: false, follow: false } };
  }
  const canonical = activitySpaceUrl(space.slug);
  const description =
    space.description ??
    `${space.name} — ${space.city ?? ''} ${space.area ?? ''}`.trim();
  return {
    title: space.name,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      title: space.name,
      description,
      type: 'website',
      url: canonical,
      siteName: space.name,
    },
  };
}

export default async function ActivitySpacePage({ params }: ActivitySpacePageProps) {
  const space = await getActivityPublicSpace(params.slug);
  if (!space) {
    notFound();
  }
  switch (space.activityType) {
    case 'imaging_center':
      return <ImagingPublicSpace space={space} />;
    case 'dental_lab':
      return <DentalLabPublicSpace space={space} />;
    default:
      return <ClinicPublicSpace space={space} />;
  }
}