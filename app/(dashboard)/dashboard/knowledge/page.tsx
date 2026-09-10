import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `knowledge` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/knowledge-base (the tenant `knowledge`
 * route canonicalizes there too).
 */
export default async function LegacyKnowledgePage() {
  redirect(await resolveTenantRedirect('/knowledge'));
}