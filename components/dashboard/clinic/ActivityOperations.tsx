'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { ACTIVITY_TYPE_LABELS_AR, type ActivityType } from '@/lib/services/activityTypes';
import { allowedTransitionsFor } from '@/lib/services/workflowStates';

/**
 * DHS-OPS — Activity Operations (Imaging / Dental Lab admin).
 *
 * Activity-specific operational UI (NOT a doctor-clinic dashboard):
 *  - imaging_services / lab_services catalog: create · edit · deactivate · delete
 *  - imaging_requests / lab_cases: create · status update · delete
 * Tenant is derived from the session (clinic_id); RBAC enforced server-side
 * (owner/manager writes). Status values come only from the domain schemas.
 */

type DomainCatalogItem = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number | null;
  turnaround_hours: number | null;
  modality: string | null;
  price: number | null;
  active: boolean;
};

type DomainRequestRow = {
  id: string;
  patient_ref: string | null;
  case_ref: string | null;
  referring_clinic: string | null;
  requested_service: string | null;
  status: string;
  notes: string | null;
};

const CATALOG_TABLE: Record<ActivityType, string | null> = {
  clinic: null,
  imaging_center: 'imaging_services',
  dental_lab: 'lab_services',
};
const REQUEST_TABLE: Record<ActivityType, string | null> = {
  clinic: null,
  imaging_center: 'imaging_requests',
  dental_lab: 'lab_cases',
};

const REQUEST_STATUS_LABELS: Record<string, string> = {
  requested: 'مطلوب',
  scheduled: 'مجدد',
  received: 'مستلم',
  in_progress: 'قيد التنفيذ',
  in_production: 'قيد الإنتاج',
  quality_check: 'فحص الجودة',
  ready: 'جاهز',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

export default function ActivityOperations({ activityType }: { activityType: ActivityType }) {
  const { isConfigured, checkFailed } = useSupabaseConfig();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [catalog, setCatalog] = useState<DomainCatalogItem[]>([]);
  const [requests, setRequests] = useState<DomainRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const catTable = CATALOG_TABLE[activityType];
  const reqTable = REQUEST_TABLE[activityType];
  const typeLabel = ACTIVITY_TYPE_LABELS_AR[activityType];

  async function refresh() {
    if (!clinicId || !catTable || !reqTable) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const q = `clinic_id=${encodeURIComponent(clinicId)}`;
      const [catBody, reqBody] = await Promise.all([
        fetch(`/api/clinic/activity-catalog?${q}&table=${catTable}`, { headers }).then((r) => r.json().catch(() => ({}))),
        fetch(`/api/clinic/activity-requests?${q}&table=${reqTable}`, { headers }).then((r) => r.json().catch(() => ({}))),
      ]);
      setCatalog(catBody?.data ?? []);
      setRequests(reqBody?.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات النشاط');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isConfigured && !checkFailed) { setLoading(false); return; }
    if (!clinicId) { setLoading(false); return; }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, clinicId, catTable, reqTable]);

  if (!isConfigured && !checkFailed) return null;
  if (loading || clinicLoading) return <Skeleton className="h-56 w-full" />;
  if (clinicError) return <EmptyState title={`تعذر تحميل ${typeLabel}`} description={clinicError} />;
  if (error) return <EmptyState title={`تعذر تحميل ${typeLabel}`} description={error} />;
  if (!catTable || !reqTable) return null;

  const isImaging = activityType === 'imaging_center';
  const colMeta = isImaging
    ? { extraKey: 'modality' as const, extraLabel: 'الجهاز', durationKey: 'duration_minutes' as const, durationLabel: 'المدة (دقيقة)' }
    : { extraKey: 'turnaround_hours' as const, extraLabel: 'الإنجاز (ساعة)', durationKey: 'turnaround_hours' as const, durationLabel: 'الإنجاز (ساعة)' };

  return (
    <section className="space-y-6">
      <CatalogManager
        table={catTable}
        isImaging={isImaging}
        items={catalog}
        colMeta={colMeta}
        authHeaders={authHeaders}
        clinicId={clinicId}
        onChanged={() => void refresh()}
      />
      <RequestsManager
        table={reqTable}
        isImaging={isImaging}
        items={requests}
        authHeaders={authHeaders}
        clinicId={clinicId}
        onChanged={() => void refresh()}
      />
    </section>
  );
}
function CatalogManager({
  table,
  isImaging,
  items,
  colMeta,
  authHeaders,
  clinicId,
  onChanged,
}: {
  table: string;
  isImaging: boolean;
  items: DomainCatalogItem[];
  colMeta: { extraKey: 'modality' | 'turnaround_hours'; extraLabel: string; durationKey: 'duration_minutes' | 'turnaround_hours'; durationLabel: string };
  authHeaders: () => Promise<Record<string, string>>;
  clinicId: string | null;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({ name: '', description: '', extra: '', duration: '', price: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function send(method: string, path: string, body?: unknown) {
    const headers = await authHeaders();
    const res = await fetch(`/api/clinic/activity-catalog${path}?clinic_id=${encodeURIComponent(clinicId!)}&table=${table}`, {
      method,
      headers: { ...headers, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? 'تعذر الحفظ');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setLocalError(null);
    try {
      const payload: Record<string, unknown> = { name: form.name.trim(), description: form.description || null };
      if (colMeta.extraKey === 'modality') payload.modality = form.extra || null;
      if (colMeta.durationKey === 'duration_minutes') payload.duration_minutes = form.duration ? Number(form.duration) : null;
      if (colMeta.durationKey === 'turnaround_hours') payload.turnaround_hours = form.duration ? Number(form.duration) : null;
      payload.price = form.price ? Number(form.price) : null;
      if (editingId) {
        await send('PUT', `/${editingId}`, payload);
      } else {
        await send('POST', '', payload);
      }
      setForm({ name: '', description: '', extra: '', duration: '', price: '' });
      setEditingId(null);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'تعذر الحفظ');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('هل تريد حذف هذا العنصر؟')) return;
    setBusy(true);
    setLocalError(null);
    try {
      await send('DELETE', `/${id}`);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: DomainCatalogItem) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description ?? '',
      extra: colMeta.extraKey === 'modality' ? (item.modality ?? '') : (item.turnaround_hours ? String(item.turnaround_hours) : ''),
      duration: colMeta.durationKey === 'duration_minutes' ? (item.duration_minutes ? String(item.duration_minutes) : '') : (item.turnaround_hours ? String(item.turnaround_hours) : ''),
      price: item.price != null ? String(item.price) : '',
    });
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-lg font-semibold text-white">{isImaging ? 'خدمات التصوير' : 'خدمات المختبر'}</h3>
      <p className="mt-1 text-sm text-slate-400">
        {isImaging ? 'كتالوج الفحوصات والطرق — منفصل عن خدمات العيادة.' : 'كتالوج خدمات المختبر مع مدة الإنجاز.'}
      </p>

      {localError && <p className="mt-3 rounded-lg border border-red-900 bg-red-950 p-2 text-sm text-red-300">{localError}</p>}

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="اسم الخدمة"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={form.extra}
          onChange={(e) => setForm({ ...form, extra: e.target.value })}
          placeholder={isImaging ? 'الجهاز (بانوراما…)' : 'مدة الإنجاز (ساعة)'}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
          type="number"
          min="0"
          placeholder="السعر (₪)"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="الوصف (اختياري)"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 sm:col-span-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-stone-900 disabled:opacity-50"
        >
          {busy ? '…' : editingId ? 'حفظ التعديل' : 'إضافة خدمة'}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
          لا توجد خدمات {isImaging ? 'تصوير' : 'مختبر'} منشورة بعد.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
              <div>
                <p className="font-semibold text-slate-100">{c.name}</p>
                {c.description && <p className="mt-0.5 text-slate-400">{c.description}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {colMeta.durationKey === 'duration_minutes' && c.duration_minutes != null ? `المدة: ${c.duration_minutes} دقيقة` : c.turnaround_hours != null ? `الإنجاز: ${c.turnaround_hours} ساعة` : ''}
                  {colMeta.extraKey === 'modality' && c.modality ? ` · ${c.modality}` : ''}
                  {c.price != null ? ` · السعر: ${c.price} ₪` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${c.active ? 'border-emerald-600 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
                  {c.active ? 'نشط' : 'معطّل'}
                </span>
                <button type="button" onClick={() => startEdit(c)} className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300">تعديل</button>
                <button type="button" onClick={() => remove(c.id)} className="rounded border border-rose-800 px-2 py-0.5 text-xs text-rose-300">حذف</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestsManager({
  table,
  isImaging,
  items,
  authHeaders,
  clinicId,
  onChanged,
}: {
  table: string;
  isImaging: boolean;
  items: DomainRequestRow[];
  authHeaders: () => Promise<Record<string, string>>;
  clinicId: string | null;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({ ref: '', service: '', referring: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function send(method: string, path: string, body?: unknown) {
    const headers = await authHeaders();
    const res = await fetch(`/api/clinic/activity-requests${path}?clinic_id=${encodeURIComponent(clinicId!)}&table=${table}`, {
      method,
      headers: { ...headers, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? 'تعذر العملية');
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      await send('POST', '', {
        patient_ref: isImaging ? (form.ref || null) : null,
        case_ref: isImaging ? null : (form.ref || null),
        requested_service: form.service || null,
        referring_clinic: form.referring || null,
        notes: form.notes || null,
      });
      setForm({ ref: '', service: '', referring: '', notes: '' });
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'تعذر الإنشاء');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    setLocalError(null);
    try {
      await send('PATCH', `/${id}`, { status });
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'تعذر تحديث الحالة');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('هل تريد حذف هذا الطلب/الحالة؟')) return;
    setBusy(true);
    setLocalError(null);
    try {
      await send('DELETE', `/${id}`);
      onChanged();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'تعذر الحذف');
    } finally {
      setBusy(false);
    }
  }

  // PHASE 1B — the UI offers ONLY transitions the workflow machine allows; the
  // server (workflowService) remains the single enforcement point.
  const workflowEntity = isImaging ? 'imaging_requests' : 'lab_cases';
  const nextStatusOptions = (status: string) => allowedTransitionsFor(workflowEntity, status);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-lg font-semibold text-white">{isImaging ? 'طلبات التصوير' : 'حالات المختبر'}</h3>
      <p className="mt-1 text-sm text-slate-400">
        {isImaging ? 'طلبات فحص من العيادات أو المرضى.' : 'حالات واردة من العيادات لمتابعة الإنتاج والتسليم.'}
      </p>

      {localError && <p className="mt-3 rounded-lg border border-red-900 bg-red-950 p-2 text-sm text-red-300">{localError}</p>}

      <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-3">
        <input
          value={form.ref}
          onChange={(e) => setForm({ ...form, ref: e.target.value })}
          placeholder={isImaging ? 'مرجع المريض (اختياري)' : 'مرجع الحالة (اختياري)'}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={form.service}
          onChange={(e) => setForm({ ...form, service: e.target.value })}
          placeholder="الخدمة المطلوبة"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <input
          value={form.referring}
          onChange={(e) => setForm({ ...form, referring: e.target.value })}
          placeholder={isImaging ? 'العيادة المحولة' : 'العيادة المُحيلة'}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        />
        <div className="flex gap-3 sm:col-span-3">
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="ملاحظات (اختياري)"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />
          <button type="submit" disabled={busy} className="shrink-0 rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-stone-900 disabled:opacity-50">
            {busy ? '…' : 'إضافة'}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">لا توجد طلبات/حالات بعد.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
              <div>
                <p className="font-semibold text-slate-100">
                  {r.requested_service ?? 'طلب'}
                  {(r.patient_ref || r.case_ref) && ` — ${r.patient_ref || r.case_ref}`}
                  {r.referring_clinic && ` (${r.referring_clinic})`}
                </p>
                {r.notes && <p className="mt-0.5 text-slate-400">{r.notes}</p>}
              </div>
              <div className="flex items-center gap-2">
                {nextStatusOptions(r.status).length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setStatus(r.id, e.target.value);
                    }}
                    disabled={busy}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                    aria-label="نقل الحالة"
                  >
                    <option value="">نقل الحالة…</option>
                    {nextStatusOptions(r.status).map((s) => (
                      <option key={s} value={s}>{REQUEST_STATUS_LABELS[s] ?? s}</option>
                    ))}
                  </select>
                ) : (
                  <span className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-500">حالة نهائية</span>
                )}
                <button type="button" onClick={() => remove(r.id)} className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300">حذف</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
