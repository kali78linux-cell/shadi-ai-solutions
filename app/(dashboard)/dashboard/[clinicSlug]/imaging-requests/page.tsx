'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import { useClinicContext } from '@/lib/useClinicContext';

/** IMAGING REQUESTS — imaging-center inbox (referral workflow UI). */
type Row = {
  id: string;
  clinic_id: string;
  referring_clinic_id: string | null;
  patient_id: string | null;
  patient_ref: string | null;
  requested_service: string | null;
  status: string;
  notes: string | null;
  created_at: string | null;
};

const STATUS_AR: Record<string, string> = {
  submitted: 'مُرسل — بانتظار القبول',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  needs_clarification: 'يحتاج توضيحًا',
  scheduled: 'مجدول',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
  cancelled: 'ملغى',
  requested: 'مطلوب',
  ready: 'جاهز للتسليم',
  delivered: 'مُسلّم',
};

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  submitted: 'warning',
  accepted: 'success',
  rejected: 'danger',
  needs_clarification: 'warning',
  scheduled: 'neutral',
  in_progress: 'neutral',
  completed: 'success',
  cancelled: 'danger',
};

const NEXT: Record<string, string[]> = {
  submitted: ['accepted', 'rejected', 'needs_clarification', 'cancelled'],
  accepted: ['scheduled', 'cancelled'],
  needs_clarification: ['submitted', 'cancelled'],
  scheduled: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'completed', 'cancelled'],
  ready: ['delivered', 'completed', 'cancelled'],
};

export default function ImagingRequestsPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    const headers = await authHeaders();
    const res = await fetch(`/api/clinic/activity-requests?clinic_id=${encodeURIComponent(clinicId)}&table=imaging_requests`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body?.error ?? 'تعذر تحميل طلبات التصوير');
      setRows([]);
      return;
    }
    const body = await res.json();
    setRows((body?.data ?? []) as Row[]);
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (loading || !clinicId) return;
    void load();
  }, [loading, clinicId, load]);

  async function transition(requestId: string, toStatus: string) {
    if (!clinicId) return;
    setBusyId(requestId);
    setErr(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/activity-requests/${requestId}?clinic_id=${encodeURIComponent(clinicId)}&table=imaging_requests`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ status: toStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'تعذر تحديث الحالة');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Skeleton className="h-60" />;
  if (clinicError) return <EmptyState title="تعذر تحميل الطلبات" description={clinicError} />;

  return (
    <DashboardSection title="طلبات التصوير" subtitle="الطلبات الواردة من العيادات المحيلة — راجع، اقبل، رفض، أو حدد موعدًا.">
      {err && <p className="mb-4 text-sm text-red-400">{err}</p>}
      {rows === null ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد طلبات تصوير" description="ستظهر هنا الطلبات الواردة من العيادات المحيلة المرتبطة بمركزك." />
      ) : (
        <div className="space-y-4">
          {rows.map((r) => (
            <RequestCard key={r.id} r={r} busy={busyId === r.id} onTransition={transition} />
          ))}
        </div>
      )}
    </DashboardSection>
  );
function RequestCard({ r, busy, onTransition }: { r: Row; busy: boolean; onTransition: (id: string, to: string) => void }) {
  const nexts = NEXT[r.status] ?? [];
  const refName = r.referring_clinic_id ? r.referring_clinic_id.slice(0, 8) + '…' : null;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-white">{r.requested_service ?? 'طلب تصوير'}</p>
          <p className="mt-1 text-sm text-slate-400">
            المريض: {r.patient_ref ?? (r.patient_id ? r.patient_id.slice(0, 8) + '…' : '—')}
            {refName ? ` · العيادة المحيلة: ${refName}` : ''}
          </p>
        </div>
        <StatusPill tone={TONE[r.status] ?? 'neutral'}>{STATUS_AR[r.status] ?? r.status}</StatusPill>
      </div>
      {r.notes && <p className="mt-2 text-sm text-slate-300">{r.notes}</p>}
      <p className="mt-2 text-xs text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString('ar') : ''}</p>
      {nexts.length > 0 && !busy && (
        <div className="mt-3 flex flex-wrap gap-2">
          {nexts.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onTransition(r.id, s)}
              className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/70 hover:text-white"
            >
              {s === 'accepted' ? 'قبول' : s === 'rejected' ? 'رفض' : s === 'cancelled' ? 'إلغاء' : STATUS_AR[s] ?? s}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="mt-3 text-xs text-cyan-300">جارٍ التحديث…</p>}
    </div>
  );
}
}