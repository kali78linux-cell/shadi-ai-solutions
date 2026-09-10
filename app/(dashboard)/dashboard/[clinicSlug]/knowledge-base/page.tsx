'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import { ClinicKnowledgeDocument } from '@/types/db';
import { StatCards } from '@/components/dashboard/knowledge/StatCards';
import UpgradeCta from '@/components/dashboard/subscription/UpgradeCta';
import { dashboardStatus } from '@/lib/i18n';
import { parseEntitlementError } from '@/lib/subscription/upgradeCta';
import type { EntitlementResource } from '@/lib/subscription/entitlements';

type UploadStatus = {
  state: 'idle' | 'uploading' | 'done' | 'error';
  message: string;
};

function formatBytes(bytes: number, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** index;
  return `${size.toFixed(index === 0 ? 0 : decimals)} ${units[index]}`;
}

export default function KnowledgeBasePage() {
  const { isConfigured: isSupabaseConfigured, checkFailed } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<ClinicKnowledgeDocument[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ state: 'idle', message: 'جاهز للرفع.' });
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({});
  const [blockedResource, setBlockedResource] = useState<EntitlementResource | null>(null);

  const fetchDocuments = useCallback(async (id?: string) => {
    const cid = id ?? clinicId;
    if (!cid) return;
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/ai/knowledge/documents?clinic_id=${encodeURIComponent(cid)}`, { headers });
      if (!response.ok) throw new Error('Failed to fetch documents');
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (!isSupabaseConfigured && !checkFailed) { setIsLoading(false); return; }
    if (clinicLoading) { setIsLoading(true); return; }
    if (!clinicId) {
      if (clinicError) console.error(clinicError);
      setIsLoading(false);
      return;
    }
    void fetchDocuments(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  // Poll for status updates on documents that are being processed
  useEffect(() => {
    const hasPendingDocuments = documents.some(doc => ['pending', 'processing', 'chunking', 'embedding'].includes(doc.processing_status));
    if (!hasPendingDocuments) return;
    const intervalId = setInterval(fetchDocuments, 5000);
    return () => clearInterval(intervalId);
  }, [documents, fetchDocuments]);

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter((item) => item.original_filename.toLowerCase().includes(normalized));
  }, [query, documents]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file || !clinicId) return;
    setUploadStatus({ state: 'uploading', message: `جارٍ رفع ${file.name}...` });
    const formData = new FormData();
    formData.append('file', file);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/ai/knowledge/upload?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        // STEP 15G-B — capture 402 ENTITLEMENT_LIMIT_REACHED and offer an upgrade CTA.
        const blocked = parseEntitlementError(errorData);
        if (blocked) {
          setBlockedResource(blocked.resource);
          setUploadStatus({ state: 'error', message: 'وصلت إلى الحد الأقصى لمستندات قاعدة المعرفة في هذه الخطة.' });
          return;
        }
        throw new Error(errorData.error || 'Upload failed');
      }
      setBlockedResource(null);
      const { document: newDocument } = await response.json();
      setDocuments((prev) => [newDocument, ...prev]);
      setUploadStatus({ state: 'done', message: `تم رفع ${file.name} بنجاح، وبدأت المعالجة.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      setUploadStatus({ state: 'error', message: `فشل الرفع: ${message}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, authHeaders]);

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) handleFileUpload(file);
    if (event.target) event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) handleFileUpload(file);
  }

  const handleAction = async (action: 'delete' | 'reindex', documentId: string) => {
    if (actionStates[documentId]) return;
    const isDelete = action === 'delete';
    if (isDelete && !confirm('هل أنت متأكد من حذف هذا المستند؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    setActionStates(prev => ({ ...prev, [documentId]: true }));
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/ai/knowledge/documents/${documentId}?clinic_id=${encodeURIComponent(clinicId || '')}`, {
        method: isDelete ? 'DELETE' : 'POST',
        headers,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${action} document.`);
      }
      await fetchDocuments();
    } catch (error) {
      alert(error instanceof Error ? error.message : `An unknown error occurred.`);
    } finally {
      setActionStates(prev => ({ ...prev, [documentId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <DashboardSection title="قاعدة المعرفة" subtitle="رفع وفهرسة مصادر المعرفة لمساعد العيادة الذكي.">
        {!isSupabaseConfigured && !checkFailed ? (
          <EmptyState title="Supabase غير مهيأ" description="يتاح الرفع والفهرسة بعد ربط بيئة العيادة بواجهة المعرفة الحالية." />
        ) : (
          <>
            {blockedResource ? <div className="mb-4"><UpgradeCta resource={blockedResource} /></div> : null}
            <StatCards documents={documents} />
            <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <label
                  htmlFor="knowledge-upload"
                  onDrop={handleDrop}
                  onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  className={`block rounded-[1.5rem] border border-dashed p-8 text-center transition ${isDragging ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 bg-slate-900/80'}`}
                >
                  <p className="text-lg font-semibold text-white">اسحب المستندات وأفلتها هنا</p>
                  <p className="mt-2 text-sm text-slate-400">PDF • DOCX • TXT</p>
                  <div className="mt-4 flex justify-center">
                    <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">اختر ملفاً</button>
                  </div>
                  <input ref={inputRef} id="knowledge-upload" type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={handleFileSelect} />
                </label>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                  <div>الحالة: {uploadStatus.state === 'idle' ? 'جاهز' : uploadStatus.state === 'uploading' ? 'جارٍ الرفع' : uploadStatus.state === 'done' ? 'تم' : 'خطأ'}</div>
                  <div className="mt-2">{uploadStatus.message}</div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <label htmlFor="knowledge-search" className="text-sm text-slate-400">البحث في المستندات المفهرسة</label>
                <input id="knowledge-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث باسم الملف" className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20" />
                <div className="mt-4 space-y-3">
                  {isLoading ? (
                    <p className="text-center text-slate-400">جارٍ تحميل المستندات...</p>
                  ) : filteredDocuments.length > 0 ? (
                    filteredDocuments.map((doc) => (
                      <div key={doc.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium text-slate-100">{doc.original_filename}</span>
                          <span className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs capitalize ${
                            doc.processing_status === 'indexed' ? 'border-green-500/30 bg-green-500/10 text-green-300' :
                            doc.processing_status === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' :
                            'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                          }`}>{dashboardStatus(doc.processing_status)}</span>
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-slate-400">
                          <span>{doc.chunk_count ? `${doc.chunk_count} أجزاء` : 'بانتظار المعالجة'}</span>
                          <span>{formatBytes(doc.file_size)}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-800 pt-2">
                          <button onClick={() => handleAction('reindex', doc.id)} disabled={actionStates[doc.id]} className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50">
                            {actionStates[doc.id] ? '...' : 'إعادة الفهرسة'}
                          </button>
                          <button onClick={() => handleAction('delete', doc.id)} disabled={actionStates[doc.id]} className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50">
                            {actionStates[doc.id] ? '...' : 'حذف'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-center text-sm text-slate-400">لم يتم العثور على مستندات.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DashboardSection>
    </div>
  );
}
