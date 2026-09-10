'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';
import {
  relationshipStatusLabelAr,
  relationshipStatusTone,
  type EnrichedRelationship,
  type PartnerOrg,
} from '@/lib/services/organizationRelationships';

/**
 * PHASE F — IMAGING CENTER side of the referral network:
 *   1) Incoming relationship REQUESTS from dental clinics (accept/reject).
 *   2) Connected clinics (accepted) — suspend / reactivate.
 *   3) Outbound: optionally invite a dental clinic (reverse scenario).
 * The incoming IMAGING REQUESTS themselves (medical workflow) live in the
 * imaging-requests module; this page manages the PARTNER relationship only.
 */

const TYPE_LABEL: Record<string, string> = {
  referral_partner: 'شريك إحالة',
  imaging_provider: 'مزوّد تصوير',
  lab_provider: 'مزوّد مختبر',
};

function PartnerRow({
  rel,
  busy,
  onPatch,
}: {
  rel: EnrichedRelationship;
  busy: boolean;
  onPatch: (id: string, status: string) => void;
}) {
  const partner = rel.direction === 'outgoing' ? rel.target_org : rel.source_org;
  const isIncomingRequested = rel.direction === 'incoming' && rel.status === 'requested';
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{partner.name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {TYPE_LABEL[rel.relationship_type] ?? rel.relationship_type}
            {rel.accepted_at ? ` · منذ ${new Date(rel.accepted_at).toLocaleDateString('ar')}` : ` · ${new Date(rel.created_at).toLocaleDateString('ar')}`}
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
            relationshipStatusTone(rel.status) === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : relationshipStatusTone(rel.status) === 'warning'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : relationshipStatusTone(rel.status) === 'danger'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                  : 'border-slate-600/60 bg-slate-800/60 text-slate-300'
          }`}
        >
          {relationshipStatusLabelAr(rel.status)}
          {rel.direction === 'outgoing' && rel.status === 'requested' ? ' (صادر)' : ''}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy ? (
          <span className="text-xs text-cyan-300">جارٍ التنفيذ…</span>
        ) : (
          <>
            {isIncomingRequested ? (
              <>
                <button
                  type="button"
                  onClick={() => onPatch(rel.id, 'accepted')}
                  className="rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400"
                >
                  قبول
                </button>
                <button
                  type="button"
                  onClick={() => onPatch(rel.id, 'rejected')}
                  className="rounded-full border border-rose-500/40 px-4 py-1.5 text-xs font-semibold text-rose-300 transition hover:border-rose-400"
                >
                  رفض
                </button>
              </>
            ) : null}
            {rel.status === 'accepted' ? (
              <button
                type="button"
                onClick={() => onPatch(rel.id, 'suspended')}
                className="rounded-full border border-amber-500/40 px-4 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-400"
              >
                تعليق العلاقة
              </button>
            ) : null}
            {rel.status === 'suspended' ? (
              <button
                type="button"
                onClick={() => onPatch(rel.id, 'accepted')}
                className="rounded-full border border-cyan-500/40 px-4 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400"
              >
                إعادة تفعيل
              </button>
            ) : null}
            {rel.status === 'requested' && !isIncomingRequested ? (
              <span className="text-xs text-slate-500">بانتظار قبول الطرف الآخر</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default function ReferringClinicsPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [relationships, setRelationships] = useState<EnrichedRelationship[] | null>(null);
  const [clinicPartners, setClinicPartners] = useState<PartnerOrg[] | null>(null);
  const [showInvite, setShowInvite] = useState(false);
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
      const relRes = await authedFetch(`/api/clinic/organization-relationships?clinic_id=${encodeURIComponent(clinicId)}`);
      if (!relRes.ok) {
        const b = await relRes.json().catch(() => ({}));
        throw new Error(b?.error ?? 'تعذر تحميل العيادات المحيلة');
      }
      const relBody = await relRes.json();
      setRelationships((relBody?.data ?? []) as EnrichedRelationship[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ غير متوقع');
      setRelationships((current) => current ?? []);
    }
  }, [clinicId, authedFetch]);

  useEffect(() => {
    if (loading || !clinicId) return;
    void load();
  }, [loading, clinicId, load]);

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
      setNotice(
        status === 'accepted'
          ? 'تم قبول الارتباط — أصبحت العيادة شريكًا ويمكنها إرسال الإحالات فورًا.'
          : status === 'rejected'
            ? 'تم رفض الطلب.'
            : status === 'suspended'
              ? 'تم تعليق العلاقة — لن تُقبل إحالات جديدة منها حتى إعادة التفعيل.'
              : `تم تحديث الحالة إلى: ${relationshipStatusLabelAr(status)}.`
      );
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusyId(null);
    }
  }

  async function loadClinicPartners() {
    if (!clinicId) return;
    setErr(null);
    try {
      const res = await authedFetch(`/api/clinic/partner-orgs?clinic_id=${encodeURIComponent(clinicId)}&activity=clinic`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? 'تعذر تحميل قائمة العيادات');
      }
      const body = await res.json();
      setClinicPartners((body?.data ?? []) as PartnerOrg[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    }
  }

  async function sendOutbound(center: PartnerOrg) {
    if (!clinicId) return;
    setBusyId(center.id);
    setErr(null);
    setNotice(null);
    try {
      const res = await authedFetch(`/api/clinic/organization-relationships?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target_org_id: center.id, relationship_type: 'referral_partner' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'تعذر إرسال الطلب');
      setNotice(`تم إرسال طلب الارتباط إلى «${center.name}» — حالته الآن قيد الانتظار.`);
      await load();
      await loadClinicPartners();
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
  const other = (relationships ?? []).filter(
    (r) => !(r.direction === 'incoming' && r.status === 'requested') && r.status !== 'accepted'
  );

  return (
    <DashboardSection
      title="العيادات المحيلة"
      subtitle="اقبل طلبات الارتباط من عيادات الأسنان، وأدِر شراكاتك — الإحالات الجديدة تُقبل من العلاقات المقبولة فقط."
    >
      {err && <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300">{err}</p>}
      {notice && <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{notice}</p>}

      {/* 1) Incoming relationship requests */}
      <section className="mb-8">
        <h3 className="mb-3 text-base font-semibold text-white">طلبات الارتباط الواردة</h3>
        {relationships === null ? (
          <Skeleton className="h-24" />
        ) : incoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
            لا توجد طلبات واردة حاليًا.
          </p>
        ) : (
          <ul className="space-y-3">
            {incoming.map((rel) => (
              <PartnerRow key={rel.id} rel={rel} busy={busyId === rel.id} onPatch={patch} />
            ))}
          </ul>
        )}
      </section>

      {/* 2) Connected clinics */}
      <section className="mb-8">
        <h3 className="mb-3 text-base font-semibold text-white">العيادات المرتبطة</h3>
        {relationships === null ? (
          <Skeleton className="h-24" />
        ) : active.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
            لا توجد عيادات مرتبطة بعد — اقبل طلب ارتباط ليظهر هنا.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((rel) => (
              <PartnerRow key={rel.id} rel={rel} busy={busyId === rel.id} onPatch={patch} />
            ))}
          </ul>
        )}
      </section>

      {/* 3) Other (outgoing pending / suspended / rejected) */}
      {other.length > 0 ? (
        <section className="mb-8">
          <h3 className="mb-3 text-base font-semibold text-white">أخرى</h3>
          <ul className="space-y-3">
            {other.map((rel) => (
              <PartnerRow key={rel.id} rel={rel} busy={busyId === rel.id} onPatch={patch} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* 4) Optional reverse scenario — invite a dental clinic */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-white">دعوة عيادة للتعاون</h3>
          <button
            type="button"
            onClick={() => {
              setShowInvite((v) => !v);
              if (!showInvite && clinicPartners === null) void loadClinicPartners();
            }}
            className="rounded-full border border-slate-600 px-4 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-500/70 hover:text-cyan-200"
          >
            {showInvite ? 'إخفاء' : 'إرسال طلب ارتباط لعيادة'}
          </button>
        </div>
        {showInvite ? (
          clinicPartners === null ? (
            <Skeleton className="mt-3 h-24" />
          ) : clinicPartners.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">لا توجد عيادات لعرضها.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {clinicPartners.map((c) => {
                const rel = c.relationship;
                const actionable = !rel || rel.status === 'rejected' || rel.status === 'canceled';
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-sm text-slate-200">{c.name}</p>
                    {rel ? (
                      <span className="text-xs text-slate-500">{relationshipStatusLabelAr(rel.status)}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void sendOutbound(c)}
                        className="rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-60"
                      >
                        إرسال طلب ارتباط
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </section>
    </DashboardSection>
  );
}
