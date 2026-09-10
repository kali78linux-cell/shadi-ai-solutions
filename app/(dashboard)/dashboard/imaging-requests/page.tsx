import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `imaging-requests` path (compat redirect). */
export default async function LegacyImagingRequestsPage() {
  redirect(await resolveTenantRedirect('/imaging-requests'));
}