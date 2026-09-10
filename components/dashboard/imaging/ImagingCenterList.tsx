'use client';

import { useMemo, useState } from 'react';
import {
  relationshipStatusLabelAr,
  relationshipStatusTone,
  type PartnerOrg,
} from '@/lib/services/organizationRelationships';

/**
 * PHASE F — reusable partner list for the referral-relationship UI.
 * Self-contained search (by name/city/area) + per-org relationship state:
 *   - no relationship (or rejected/canceled) → "إرسال طلب ارتباط"
 *   - requested (outgoing) → قيد الانتظار badge
 *   - accepted → مقبول badge + تعليق العلاقة
 *   - suspended → معلّق badge + إعادة تفعيل
 * Mutations are delegated to the parent via callbacks (single API surface).
 */

type Props = {
  centers: PartnerOrg[];
  loading?: boolean;
  busyId?: string | null;
  onSendRequest?: (center: PartnerOrg) => void;
  onSuspend?: (center: PartnerOrg) => void;
  onReactivate?: (center: PartnerOrg) => void;
};

const TONE_CLS: Record<string, string> = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  danger: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  neutral: 'border-slate-600/60 bg-slate-800/60 text-slate-300',
};

function StatusBadge({ status }: { status: string }) {
  const tone = relationshipStatusTone(status);
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${TONE_CLS[tone] ?? TONE_CLS.neutral}`}>
      {relationshipStatusLabelAr(status)}
    </span>
  );
}

export default function ImagingCenterList({
  centers,
  loading = false,
  busyId = null,
  onSendRequest,
  onSuspend,
  onReactivate,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return centers;
    return centers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.city ?? '').toLowerCase().includes(q) ||
        (c.area ?? '').toLowerCase().includes(q)
    );
  }, [centers, query]);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-2xl bg-slate-800/60" aria-busy="true" />;
  }

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث باسم مركز التصوير أو المدينة…"
        aria-label="البحث في مراكز التصوير"
        className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
      />

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
          {query ? 'لا نتائج مطابقة للبحث.' : 'لا توجد مراكز مسجلة بعد.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((center) => {
            const rel = center.relationship;
            const busy = busyId === center.id;
            const actionable = !rel || rel.status === 'rejected' || rel.status === 'canceled';
            return (
              <li key={center.id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-white">{center.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[center.city, center.area].filter(Boolean).join(' — ') || '—'}
                    </p>
                  </div>
                  {rel ? <StatusBadge status={rel.status} /> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {busy ? (
                    <span className="text-xs text-cyan-300">جارٍ التنفيذ…</span>
                  ) : (
                    <>
                      {actionable && onSendRequest ? (
                        <button
                          type="button"
                          onClick={() => onSendRequest(center)}
                          className="rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-cyan-400"
                        >
                          إرسال طلب ارتباط
                        </button>
                      ) : null}
                      {rel?.status === 'requested' && rel.direction === 'outgoing' ? (
                        <span className="text-xs text-slate-500">بانتظار قبول الطرف الآخر</span>
                      ) : null}
                      {rel?.status === 'requested' && rel.direction === 'incoming' ? (
                        <span className="text-xs text-amber-300">طلب وارد من هذه الجهة — راجع قسم الطلبات الواردة</span>
                      ) : null}
                      {rel?.status === 'accepted' && onSuspend ? (
                        <button
                          type="button"
                          onClick={() => onSuspend(center)}
                          className="rounded-full border border-amber-500/40 px-4 py-1.5 text-xs font-semibold text-amber-200 transition hover:border-amber-400"
                        >
                          تعليق العلاقة
                        </button>
                      ) : null}
                      {rel?.status === 'suspended' && onReactivate ? (
                        <button
                          type="button"
                          onClick={() => onReactivate(center)}
                          className="rounded-full border border-cyan-500/40 px-4 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400"
                        >
                          إعادة تفعيل
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
