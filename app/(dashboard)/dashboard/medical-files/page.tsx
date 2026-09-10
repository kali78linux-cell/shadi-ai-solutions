import { redirect } from 'next/navigation';
import { resolveTenantRedirect } from '@/lib/services/tenantAccess';

export const dynamic = 'force-dynamic';

/** Legacy flat `medical-files` path (compat redirect). */
export default async function LegacyMedicalFilesPage() {
  redirect(await resolveTenantRedirect('/medical-files'));
}