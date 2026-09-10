import { redirect } from 'next/navigation';

/**
 * TENANT-ISOLATED DASHBOARD — `/dashboard/{clinicSlug}` canonical tenant index.
 * The server layout already resolved + verified the tenant from the slug;
 * this page simply canonicals to the tenant overview.
 */
export default function TenantDashboardIndexPage({
  params,
}: {
  params: { clinicSlug: string };
}) {
  redirect(`/dashboard/${encodeURIComponent(params.clinicSlug)}/overview`);
}
