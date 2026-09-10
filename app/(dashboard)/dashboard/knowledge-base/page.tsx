import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/**
 * TENANT-ISOLATED DASHBOARD — legacy flat `knowledge-base` path (compat redirect).
 * Canonical URL is /dashboard/{clinicSlug}/knowledge-base.
 */
export default async function LegacyKnowledgeBasePage() {
  redirect(await resolveTenantRedirect('/knowledge-base'));
}