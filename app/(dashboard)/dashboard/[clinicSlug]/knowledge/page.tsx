import { redirect } from 'next/navigation';

/**
 * TENANT-ISOLATED DASHBOARD — legacy `knowledge` path canonicalizes to the
 * tenant-scoped `knowledge-base` module.
 */
export default function TenantKnowledgeLegacyPage({
  params,
}: {
  params: { clinicSlug: string };
}) {
  redirect(`/dashboard/${encodeURIComponent(params.clinicSlug)}/knowledge-base`);
}
