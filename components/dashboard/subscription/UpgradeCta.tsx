'use client';

// STEP 15G-B — Upgrade CTA banner shown when the clinic hits an entitlement limit.
// Displays a clear Arabic message + usage detail (when available) + an upgrade
// button that routes to the TENANT-SCOPED subscription page:
//   /dashboard/{clinicSlug}/subscription?upgrade=1&resource=...&plan=...
// The slug is read from the tenant dashboard route (source of truth) — never
// from client tenant state. Never leaks internals; staff-only rendering.

import { useParams } from 'next/navigation';
import {
  ENTITLEMENT_BLOCK_MSG,
  buildUpgradeHref,
  RESOURCE_LABEL_AR,
} from '@/lib/subscription/upgradeCta';
import type { EntitlementResource } from '@/lib/subscription/entitlements';

export type UpgradeCtaProps = {
  resource: EntitlementResource;
  plan?: string | null;
  used?: number | null;
  limit?: number | null;
  /** When true the resource is unlimited → we render nothing. */
  unlimited?: boolean;
};

export default function UpgradeCta({ resource, plan, used, limit, unlimited }: UpgradeCtaProps) {
  // Tenant routing: the slug comes from the dashboard route (source of truth),
  // so the CTA lands on /dashboard/{clinicSlug}/subscription — never the flat one.
  const params = useParams<{ clinicSlug?: string }>();
  const clinicSlug = typeof params?.clinicSlug === 'string' ? params.clinicSlug : null;
  if (unlimited) return null;
  const href = buildUpgradeHref(resource, plan ?? null, clinicSlug);
  if (!href) return null;

  return (
    <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">
            {ENTITLEMENT_BLOCK_MSG[resource] ?? `وصلتَ إلى حد ${RESOURCE_LABEL_AR[resource] ?? resource}.`}
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            {used != null && limit != null
              ? `الاستهلاك الحالي: ${used} من ${limit} · ${RESOURCE_LABEL_AR[resource] ?? resource}`
              : `الموارد المتأثرة: ${RESOURCE_LABEL_AR[resource] ?? resource}`}
          </p>
        </div>
        <a
          href={href}
          className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
        >
          عرض خطة الترقية
        </a>
      </div>
    </div>
  );
}