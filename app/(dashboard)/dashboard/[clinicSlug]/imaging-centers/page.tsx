'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';
import ImagingCenterList from '@/components/dashboard/imaging/ImagingCenterList';
import {
  relationshipStatusLabelAr,
  relationshipStatusTone,
  type EnrichedRelationship,
  type PartnerOrg,
} from '@/lib/services/organizationRelationships';

/**
 * PHASE F — CLINIC SIDE of the referral network:
 *   1) Incoming relationship requests (reverse flow — an imaging center may
 *      also invite the clinic; the clinic accepts/declines here).
 *   2) Available imaging centers (search + send request + live status).
 *   3) Active partnerships (accepted, with suspend).
 * All mutations go through the single organization-relationships API.
 */

type IncomingRequest = EnrichedRelationship;

export default function ImagingCentersPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [centers, setCenters] = useState<PartnerOrg[] | null>(null);
  const [relationships, setRelationships] = useState<EnrichedRelationship[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const authedFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const headers = await authHeaders();
      return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...headers } });
    },
    [authHeaders]
  );

  const load = useCallback(async () => {
    if (!clinicId) return;
    setErr(null);
    try {
      const [centersRes, relRes] = await Promise.all([
        authedFetch(`/api/clinic/partner-orgs?clinic_id=${encodeURIComponent(clinicId)}&activity=imaging_center`),
        authedFetch(`/api/clinic/organization-relationships?clinic_id=${encodeURIComponent(clinicId)}`),
      ]);
      if (!centersRes.ok) {
        const b = await centersRes.json().catch(() => ({}));
        throw new Error(b?.error ?? 'تعذر تحميل مراكز التصوير');
      }
      if (!relRes.ok) {
        const b = await relRes.json().catch(() => ({}));
        throw new Error(b?.error ?? 'تعذر تحميل العلاقات');
      }
      const centersBody = await centersRes.json();
      const relBody = await relRes.json();
      setCenters((centersBody?.data ?? []) as PartnerOrg[]);
      setRelationships((relBody?.data ?? []) as EnrichedRelationship[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
      setCenters((current) => current ?? []);
      setRelationships((current) => current ?? []);
    }
  }, [clinicId, authedFetch]);

  useEffect(() => {
    if (loading || !clinicId) return;
    void load();
  }, [loading, clinicId, load]);

  async function sendRequest(center: PartnerOrg) {
    if (!clinicId) return;
    setBusyId(center.id);
    setErr(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/clinic/organization-relationships?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_org_id: center.id, relationship_type: 'imaging_provider' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'تعذر إرسال الطلب');
      setNotice(`تم إرسال الطلب بنجاح إلى «${center.name}» — حالته الآن قيد الانتظار.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusyId(null);
    }
  }

  async function patch(relationshipId: string, status: string) {
    if (!clinicId) return;
    setBusyId(relationshipId);
    setErr(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/clinic/organization-relationships?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ relationship_id: relationshipId, status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'تعذر تحديث العلاقة');
      setNotice(status === 'suspended' ? 'تم تعليق العلاقة.' : `تم تحديث حالة العلاقة إلى: ${relationshipStatusLabelAr(status)}.`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Skeleton className="h-60" />;
  if (clinicError) return <EmptyState title="تعذر التحميل" description={clinicError} />;

  const incoming = (relationships ?? []).filter(
    (r) => r.direction === 'incoming' && r.status === 'requested'
  );
  const active = (relationships ?? []).filter((r) => r.status === 'accepted');

  return (
    <DashboardSection
      title="مراكز التصوير"
      subtitle="ابحث عن مراكز التصوير، أرسل طلب ارتباط، وتابع حالة العلاقات — الإحالات تعمل مع العلاقات المقبولة فقط."
    >
      {err && <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{err}</p>}
      {notice && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{notice}</p>}

      {/* 1) Incoming requests (reverse flow) */}
      <section className="mb-8">
        <h3 className="mb-3 text-base font-semibold text-white">طلبات واردة من مراكز التصوير</h3>
        {relationships === null ? (
          <Skeleton className="h-24" />
        ) : incoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">لا توجد طلبات واردة.</p>
        ) : (
          <ul className="space-y-3">
            {incoming.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div>
                  <p className="font-semibold text-white">{r.source_org.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">طلب ارتباط · {new Date(r.created_at).toLocaleDateString('ar')}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void patch(r.id, 'accepted')}
                    className="rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
                  >
                    قبول
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void patch(r.id, 'rejected')}
                    className="rounded-full border border-rose-500/40 px-4 py-1.5 text-xs font-semibold text-rose-300 transition hover:border-rose-400 disabled:opacity-60"
                  >
                    رفض
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2) Available imaging centers */}
      <section className="mb-8">
        <h3 className="mb-3 text-base font-semibold text-white">مراكز التصوير المتاحة</h3>
        <ImagingCenterList
          centers={centers ?? []}
          loading={centers === null}
          busyId={busyId}
          onSendRequest={(center) => void sendRequest(center)}
          onSuspend={(center) => center.relationship && void patch(center.relationship.id, 'suspended')}
          onReactivate={(center) => center.relationship && void patch(center.relationship.id, 'accepted')}
        />
      </section>

      {/* 3) Active partnerships */}
      <section>
        <h3 className="mb-3 text-base font-semibold text-white">العلاقات النشطة</h3>
        {relationships === null ? (
          <Skeleton className="h-24" />
        ) : active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
            لا توجد علاقات نشطة بعد — أرسل طلب ارتباط وستظهر هنا بعد القبول.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((r) => {
              const partner = r.direction === 'outgoing' ? r.target_org : r.source_org;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div>
                    <p className="font-semibold text-white">{partner.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.relationship_type === 'imaging_provider' ? 'مزوّد تصوير' : r.relationship_type === 'referral_partner' ? 'شريك إحالة' : 'مزوّد مختبر'}
                      {r.accepted_at ? ` · منذ ${new Date(r.accepted_at).toLocaleDateString('ar')}` : ''}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${relationshipStatusTone(r.status) === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : ''}`}>
                    {relationshipStatusLabelAr(r.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </DashboardSection>
  );
}
