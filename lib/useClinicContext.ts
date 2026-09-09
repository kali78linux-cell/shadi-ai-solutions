'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';

type ClinicMembership = {
  clinic_id: string;
  role: string;
  clinic: { id: string; name: string; slug: string; activity_type: string | null } | null;
};

export type ClinicContext = {
  loading: boolean;
  error: string | null;
  clinicId: string | null;
  clinicSlug: string | null;
  clinicName: string | null;
  activityType: string | null;
  role: string | null;
  memberships: ClinicMembership[];
  /** Real auth headers: Authorization Bearer <access_token> */
  authHeaders: () => Promise<Record<string, string>>;
  /** Switch active clinic (must be one of the user's memberships) */
  setActiveClinicId: (id: string) => Promise<void>;
};

/**
 * Centralized real clinic context.
 * Resolves the current clinic from:
 *   Supabase Auth session → clinic_users membership → clinic record
 * Never trusts a clinic_id sent from the client.
 */
export function useClinicContext(): ClinicContext {
  const { isConfigured } = useSupabaseConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<ClinicMembership[]>([]);

  const activeMembership = useMemo(
    () => memberships.find((m) => m.clinic_id === clinicId) ?? memberships[0] ?? null,
    [memberships, clinicId]
  );

  async function getAccessToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const resolveClinic = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false);
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      setLoading(false);
      setError('Not authenticated');
      return;
    }

    // 1. Load real memberships from clinic_users
    const { data, error: membershipError } = await supabase
      .from('clinic_users')
      .select('clinic_id, role, clinic:clinics(id, name, slug, activity_type)')
      .eq('user_id', sessionData.session.user.id)
      .is('deleted_at', null);

    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const rows: ClinicMembership[] = (data ?? [])
      .filter((r) => Boolean(r && r.clinic_id))
      .map((r) => ({
        clinic_id: r.clinic_id,
        role: r.role,
        clinic: Array.isArray(r.clinic) ? (r.clinic[0] ?? null) : (r.clinic ?? null),
      }));

    setMemberships(rows);

    if (rows.length === 0) {
      setClinicId(null);
      setRole(null);
      setLoading(false);
      return;
    }

    // 2. Keep the active clinic if still a member, otherwise default to first
    setClinicId((current) => {
      const stillMember = current && rows.some((m) => m.clinic_id === current);
      const next = stillMember ? current : rows[0].clinic_id;
      const membership = rows.find((m) => m.clinic_id === next);
      setRole(membership?.role ?? null);
      return next;
    });

    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured]);

  useEffect(() => {
    void resolveClinic();
  }, [resolveClinic]);

  const setActiveClinicId = useCallback(
    async (id: string) => {
      const membership = memberships.find((m) => m.clinic_id === id);
      if (!membership) {
        setError('You are not a member of this clinic');
        return;
      }
      setClinicId(id);
      setRole(membership.role);
      setError(null);
    },
    [memberships]
  );

  const active = memberships.find((m) => m.clinic_id === clinicId) ?? activeMembership;

  return {
    loading,
    error,
    clinicId: active?.clinic_id ?? clinicId,
    clinicSlug: active?.clinic?.slug ?? null,
    clinicName: active?.clinic?.name ?? null,
    activityType: active?.clinic?.activity_type ?? null,
    role,
    memberships,
    authHeaders,
    setActiveClinicId,
  };
}