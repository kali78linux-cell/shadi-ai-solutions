'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * PHASE I — Unified patient financial + medical file panel.
 *
 * Reusable panel inside the patient page when a patient is selected.
 * Reads only; all mutations go through the authoritative RPCs
 * (issue_invoice / record_payment) and the medical-file upload route.
 */

type InvoiceRow = {
  id: string;
  invoice_number?: string | null;
  patient_id?: string | null;
  total?: number;
  total_amount?: number;
  total_due?: number;
  balance_due?: number;
  paid_amount?: number;
  status?: string;
  created_at?: string | null;
};

type PaymentRow = {
  id: string;
  invoice_id?: string | null;
  amount?: number;
  method?: string | null;
  status?: string;
  receipt_number?: string | null;
  created_at?: string | null;
};

type BalanceRow = {
  balance_due?: number;
};

type MedicalFileRow = {
  id: string;
  file_type?: string | null;
  original_filename?: string | null;
  size_bytes?: number | null;
  created_at?: string | null;
};

type Props = {
  patientId: string;
  patientName?: string | null;
};

const METHOD_AR: Record<string, string> = {
  cash: 'نقداً',
  card: 'بطاقة',
  bank_transfer: 'تحويل بنكي',
  insurance: 'تأمين',
  other: 'أخرى',
};

/** Strict UUID v4-shape guard — invoice ids must be UUIDs before hitting the RPC. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function PatientFinancialFilesPanel({ patientId, patientName }: Props) {
  const { clinicId, authHeaders } = useClinicContext();

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [files, setFiles] = useState<MedicalFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invDesc, setInvDesc] = useState('');
  const [invAmount, setInvAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payInvoiceId, setPayInvoiceId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'insurance' | 'other'>('cash');

  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAll = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const [invRes, payRes, balRes, fileRes] = await Promise.all([
        fetch(`/api/clinic/accounting/invoices?clinic_id=${clinicId}&patient_id=${patientId}`, { headers }),
        fetch(`/api/clinic/accounting/payments?clinic_id=${clinicId}`, { headers }),
        fetch(`/api/clinic/accounting/balances?clinic_id=${clinicId}&patient_id=${patientId}`, { headers }),
        fetch(`/api/clinic/medical-files/list?clinic_id=${clinicId}&patient_id=${patientId}`, { headers }),
      ]);
      const inv = await invRes.json();
      const pay = await payRes.json();
      const bal = await balRes.json();
      const fl = await fileRes.json();
      if (!invRes.ok) throw new Error(inv.error || 'فشل تحميل الفواتير');
      if (!payRes.ok) throw new Error(pay.error || 'فشل تحميل المدفوعات');
      if (!balRes.ok) throw new Error(bal.error || 'فشل تحميل الرصيد');
      if (!fileRes.ok) throw new Error(fl.error || 'فشل تحميل الملفات');

      const invoicesList: InvoiceRow[] = (inv.data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        // invoice_balances exposes `invoice_id` (not `id`) — normalize so every
        // row carries a real UUID. Prevents "invalid input syntax for type uuid"
        // when recording a payment against an invoice.
        id: String(r.invoice_id ?? r.id ?? ''),
      })).filter((r: InvoiceRow) => UUID_RE.test(r.id));
      const invoiceIds = new Set(invoicesList.map((r) => r.id));
      const paymentsList = (pay.data ?? []).filter((p: PaymentRow) => p.invoice_id && invoiceIds.has(p.invoice_id));

      setInvoices(invoicesList);
      setPayments(paymentsList);
      setBalances(bal.data ?? []);
      setFiles(fl.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ في تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [clinicId, patientId, authHeaders]);

  useEffect(() => {
    void loadAll();
  }, [loadAll, patientId]);

  const openFile = useCallback(
    async (fileId: string) => {
      if (!clinicId) return;
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/clinic/medical-files/${fileId}?clinic_id=${clinicId}`, { headers });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'تعذر فتح الملف');
        window.open(json.data.signed_url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'تعذر فتح الملف');
      }
    },
    [clinicId, authHeaders]
  );

  const issueInvoice = async () => {
    if (!clinicId) return;
    const amount = Number(invAmount);
    if (!invDesc.trim() || !Number.isFinite(amount) || amount <= 0) {
      setActionError('أدخل وصفاً ومبلغاً صحيحاً');
      return;
    }
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/clinic/accounting/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: patientId,
          items: [{ description: invDesc.trim(), quantity: 1, unit_price: amount }],
          notes: null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل إصدار الفاتورة');
      setActionSuccess(`تم إصدار الفاتورة ${json.data?.invoiceNumber ?? ''}`);
      setShowInvoiceForm(false);
      setInvDesc('');
      setInvAmount('');
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSubmitting(false);
    }
  };

  const recordPayment = async () => {
    if (!clinicId) return;
    const amount = Number(payAmount);
    if (!payInvoiceId || !Number.isFinite(amount) || amount <= 0) {
      setActionError('اختر فاتورة وأدخل مبلغاً صحيحاً');
      return;
    }
    if (!UUID_RE.test(payInvoiceId)) {
      setActionError('معرّف الفاتورة غير صالح — أعد تحميل الصفحة وحاول مجدداً');
      return;
    }
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/clinic/accounting/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          clinic_id: clinicId,
          invoice_id: payInvoiceId,
          amount,
          method: payMethod,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تسجيل الدفعة');
      setActionSuccess(`تم تسجيل الدفعة ${json.data?.receiptNumber ?? ''}`);
      setShowPaymentForm(false);
      setPayAmount('');
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSubmitting(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!clinicId) return;
    setUploadBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/medical-files?clinic_id=${clinicId}&patient_id=${patientId}`, {
        method: 'POST',
        headers,
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل رفع الملف');
      setActionSuccess('تم رفع الملف الطبي ✓');
      await loadAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'حدث خطأ في الرفع');
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const invoiceTotal = useMemo(() => {
    const g = (r: InvoiceRow) => Number(r.total_amount ?? r.total ?? r.total_due ?? r.balance_due ?? 0);
    return invoices.reduce((s, r) => s + g(r), 0);
  }, [invoices]);

  const paymentTotal = useMemo(
    () => payments.filter((p) => p.status === 'recorded').reduce((s, p) => s + Number(p.amount ?? 0), 0),
    [payments]
  );

  const balance = useMemo(() => {
    if (balances.length > 0) return Number(balances[0].balance_due ?? 0);
    return invoiceTotal - paymentTotal;
  }, [balances, invoiceTotal, paymentTotal]);

  if (loading) {
    return <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">جارٍ تحميل الملف المالي والطبي...</div>;
  }
return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">الملف المالي والطبي {patientName ? `— ${patientName}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowInvoiceForm((v) => !v)}
            className="rounded-full bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
          >
            + إصدار فاتورة
          </button>
          <button
            type="button"
            onClick={() => setShowPaymentForm((v) => !v)}
            className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30"
          >
            + إضافة دفعة
          </button>
          <label
            className={`cursor-pointer rounded-full bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/30 ${uploadBusy ? 'opacity-50' : ''}`}
          >
            {uploadBusy ? 'جارٍ الرفع...' : '+ إرفاق ملف'}
            <input
              type="file"
              hidden
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,video/mp4,video/webm,video/quicktime,application/dicom"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
              }}
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>
      )}
      {actionError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{actionError}</div>
      )}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{actionSuccess}</div>
      )}

      {/* Balance summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">إجمالي الفواتير</p>
          <p className="mt-1 text-lg font-bold text-white">{invoiceTotal.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="text-xs text-slate-400">المدفوع</p>
          <p className="mt-1 text-lg font-bold text-emerald-300">{paymentTotal.toFixed(2)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${balance > 0 ? 'border-amber-500/40 bg-amber-500/5' : 'border-slate-800 bg-slate-900/60'}`}>
          <p className="text-xs text-slate-400">الرصيد المتبقي</p>
          <p className={`mt-1 text-lg font-bold ${balance > 0 ? 'text-amber-300' : 'text-slate-300'}`}>{balance.toFixed(2)}</p>
        </div>
      </div>
{/* Invoice form */}
      {showInvoiceForm && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="mb-3 text-sm font-semibold text-white">إصدار فاتورة جديدة</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <input
              type="text"
              value={invDesc}
              onChange={(e) => setInvDesc(e.target.value)}
              placeholder="وصف الخدمة (مثال: أشعة بانوراما)"
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none sm:col-span-2"
            />
            <input
              type="number"
              min="1"
              step="0.01"
              value={invAmount}
              onChange={(e) => setInvAmount(e.target.value)}
              placeholder="المبلغ (ILS)"
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void issueInvoice()}
              disabled={submitting}
              className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
            >
              {submitting ? 'جارٍ الإصدار...' : 'إصدار الفاتورة'}
            </button>
            <button
              type="button"
              onClick={() => setShowInvoiceForm(false)}
              className="rounded-full bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Payment form */}
      {showPaymentForm && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <p className="mb-3 text-sm font-semibold text-white">تسجيل دفعة</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <select
              value={payInvoiceId}
              onChange={(e) => setPayInvoiceId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/70 focus:outline-none sm:col-span-2"
            >
              <option value="">اختر الفاتورة...</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number ?? 'فاتورة'} — {(inv.total_amount ?? inv.total ?? '')}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              step="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="المبلغ"
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
            />
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500/70 focus:outline-none"
            >
              {Object.entries(METHOD_AR).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void recordPayment()}
              disabled={submitting}
              className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {submitting ? 'جارٍ التسجيل...' : 'تسجيل الدفعة'}
            </button>
            <button
              type="button"
              onClick={() => setShowPaymentForm(false)}
              className="rounded-full bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
{/* Invoices list */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-sm font-semibold text-white">الفواتير ({invoices.length})</p>
        {invoices.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد فواتير لهذا المريض.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-200">{inv.invoice_number ?? inv.id.slice(0, 8)}</p>
                  {inv.created_at && <p className="text-xs text-slate-500">{new Date(inv.created_at).toLocaleDateString('ar')}</p>}
                </div>
                <div className="text-left">
                  <p className="font-bold text-white">{Number(inv.total_amount ?? inv.total ?? 0).toFixed(2)}</p>
                  <p className={`text-xs ${inv.status === 'voided' ? 'text-rose-400' : inv.status === 'paid' ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {inv.status === 'voided' ? 'ملغاة' : inv.status === 'paid' ? 'مدفوعة' : inv.status === 'partial' ? 'مدفوعة جزئياً' : 'غير مدفوعة'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Payments list */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-sm font-semibold text-white">الدفعات ({payments.length})</p>
        {payments.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد دفعات مسجلة لهذا المريض.</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-200">
                    {METHOD_AR[p.method ?? ''] ?? p.method} {p.receipt_number ? `· ${p.receipt_number}` : ''}
                  </p>
                  {p.created_at && <p className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString('ar')}</p>}
                </div>
                <p className="font-bold text-emerald-300">+{Number(p.amount ?? 0).toFixed(2)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Medical files list */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <p className="mb-3 text-sm font-semibold text-white">الملفات الطبية ({files.length})</p>
        {files.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد ملفات طبية بعد. يمكنك إرفاق ملف أو نسخ مرفق من المحادثات.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-200">{f.original_filename ?? f.file_type ?? 'ملف'}</p>
                  <p className="text-xs text-slate-500">
                    {f.file_type ?? ''} · {f.size_bytes != null ? `${(f.size_bytes / 1024).toFixed(1)} KB` : ''} ·{' '}
                    {f.created_at ? new Date(f.created_at).toLocaleDateString('ar') : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void openFile(f.id)}
                  className="rounded-full bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
                >
                  فتح
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}