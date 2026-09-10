'use client';

import { createContext, useContext } from 'react';

/**
 * TENTEN-ISOLATED DASHBOARD — tenant context.
 *
 * The server layout (`/dashboard/[clinicSlug]/layout.tsx`) resolves + verifies
 * the tenant (auth → clinic by slug → clinic_users membership) and provides
 * the trusted result here. `useClinicContext` consumes this as the source of
 * truth and NEVER falls back to "first membership" when this is present.
 */

export type TenantContextValue = {
  clinicSlug: string;
  clinicId: string;
  clinicName: string;
  role: string;
  activityType?: string;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantContextValue;
  children: React.ReactNode;
}) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext(): TenantContextValue | null {
  return useContext(TenantContext);
}