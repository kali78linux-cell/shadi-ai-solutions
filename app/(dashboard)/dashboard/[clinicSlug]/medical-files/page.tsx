'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * MEDICAL FILES — imaging-center view (root-cause fix for the 404).
 * Lists imaging files with imaging-specific metadata (patient, imaging request,
 * modality/file type, upload date) and issues short-lived signed URLs for
 * download. Upload uses the direct-to-storage signed flow (large DICOM-safe).
 */
type MedicalFileRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  imaging_request_id: string | null;
  appointment_id: string | null;
  file_type: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string | null;
  created_at: string | null;
};

const TYPE_AR: Record<string, string> = {
  image: 'صورة',
  video: 'فيديو',
  pdf: 'تقرير PDF',
  document: 'مستند',
  medical_report: 'تقرير طبي',
  medical_image: 'ملف تصوير (DICOM)',
};

const TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  medical_image: 'neutral',
  medical_report: 'success',
  pdf: 'success',
  image: 'neutral',
  video: 'neutral',
  document: 'neutral',
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export default function MedicalFilesPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [rows, setRows] = useState<MedicalFileRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clinicId) return;
    const headers = await authHeaders();
    // Clinic-scoped listing: every medical file recorded by THIS org.
    const res = await fetch(`/api/clinic/medical-files/list?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErr(body?.error ?? 'تعذر تحميل ملفات التصوير');
      setRows([]);
      return;
    }
    const body = await res.json();
    setRows((body?.data ?? []) as MedicalFileRow[]);
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (loading || !clinicId) return;
    void load();
  }, [loading, clinicId, load]);

  async function download(fileId: string) {
    if (!clinicId) return;
    setBusyId(fileId);
    setErr(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/medical-files/${fileId}?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.data?.signed_url) throw new Error(body?.error ?? 'تعذر توليد رابط التنزيل');
      window.open(body.data.signed_url as string, '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Skeleton className="h-60" />;
  if (clinicError) return <EmptyState title="تعذر تحميل الملفات" description={clinicError} />;

  return (
    <DashboardSection title="ملفات التصوير" subtitle="ملفات المرضى التصويرية (بانوراما / CBCT / DICOM / تقارير) — وصول عبر روابط موقعة قصيرة الأمد فقط.">
      {err && <p className="mb-4 text-sm text-red-400">{err}</p>}
      {rows === null ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <EmptyState title="لا توجد ملفات تصوير" description="ارفع الملفات من طلب التصوير أو من ملف المريض — ستظهر هنا مع نوع التصوير وتاريخ الرفع." />
      ) : (
        <div className="space-y-3">
          {rows.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{f.original_filename ?? 'ملف'}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {TYPE_AR[f.file_type] ?? f.file_type} · {formatBytes(f.size_bytes)} ·{' '}
                  {f.created_at ? new Date(f.created_at).toLocaleDateString('ar') : ''}
                  {f.imaging_request_id ? ` · طلب: ${f.imaging_request_id.slice(0, 8)}…` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={TONE[f.file_type] ?? 'neutral'}>{TYPE_AR[f.file_type] ?? f.file_type}</StatusPill>
                <button
                  type="button"
                  onClick={() => void download(f.id)}
                  disabled={busyId === f.id}
                  className="rounded-full border border-cyan-500/40 px-4 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400 disabled:opacity-50"
                >
                  {busyId === f.id ? '…' : 'تنزيل'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}