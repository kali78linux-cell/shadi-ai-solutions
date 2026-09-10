'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import { useToast } from '@/components/ui/Toast';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import DashboardSection from '@/components/dashboard/DashboardSection';
import Button from '@/components/ui/Button';

type Ad = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  cta_text: string;
  cta_link: string | null;
  is_active: boolean;
  display_order: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

export default function AdsManager() {
  const { isConfigured: isSupabaseConfigured, checkFailed } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const { addToast } = useToast();
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Partial<Ad>>({});

  const endpoint = '/api/clinic/ads';

  async function load() {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'تعذر تحميل الإعلانات');
      setAds(body.data?.ads || body.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured && !checkFailed) { setLoading(false); return; }
    if (!clinicId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicId]);

  const openForm = (ad?: Ad) => {
    setEditingId(ad?.id ?? null);
    setForm(ad ?? {});
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicId || !form.title) return;
    setSubmitting(true);
    try {
      const headers = await authHeaders();
      const body: Record<string, unknown> = { ...form };

      let res: Response;
      if (editingId) {
        res = await fetch(`${endpoint}/${editingId}?clinic_id=${encodeURIComponent(clinicId)}`, {
          method: 'PUT', headers, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${endpoint}?clinic_id=${encodeURIComponent(clinicId)}`, {
          method: 'POST', headers, body: JSON.stringify(body),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر حفظ الإعلان');

      addToast({ type: 'success', message: editingId ? 'تم تحديث الإعلان' : 'تم إنشاء الإعلان' });
      closeForm();
      void load();
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'حدث خطأ' });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteAd = async (id: string) => {
    if (!clinicId) return;
    if (!confirm('هل أنت متأكد من حذف هذا الإعلان؟')) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}/${id}?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'DELETE', headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر حذف الإعلان');
      addToast({ type: 'success', message: 'تم حذف الإعلان' });
      void load();
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'حدث خطأ' });
    }
  };

  const toggleActive = async (ad: Ad) => {
    if (!clinicId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}/${ad.id}?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ is_active: !ad.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'تعذر تحديث الإعلان');
      addToast({ type: 'success', message: ad.is_active ? 'تم إلغاء التفعيل' : 'تم التفعيل' });
      void load();
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'حدث خطأ' });
    }
  };

  if (clinicError || !clinicId) {
    return (
      <DashboardSection title="إعلانات العيادة" subtitle="إدارة العروض والعروض الترويجية لعيادتك.">
        <div className="py-8 text-center text-slate-400">
          {clinicError || 'جارٍ تحميل العيادة...'}
        </div>
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      title="إعلانات العيادة"
      subtitle="أدرّش العروض والعروض الترويجية التي يراها المرضون على الصفحة الرئيسية."
      action={
        <Button variant="cta" size="sm" onClick={() => openForm()}>
          + إعلان جديد
        </Button>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
        </div>
      ) : ads.length === 0 ? (
        <div className="py-8 text-center">
          <EmptyState
            title="لا توجد إعلانات بعد"
            description="أنشئ أول إعلان ترويجي لعيادتك لتظهر على الصفحة الرئيسية."
          />
          <Button variant="cta" size="md" className="mt-4" onClick={() => openForm()}>
            إنشاء إعلان
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-white">{ad.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      ad.is_active
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-slate-600/30 text-slate-400'
                    }`}>
                      {ad.is_active ? 'نشط' : 'غير نشط'}
                    </span>
                  </div>
                  {ad.description && <p className="mt-1 text-sm text-slate-300">{ad.description}</p>}
                  {ad.cta_text && (
                    <span className="mt-1 inline-block text-xs text-cyan-300">نص الزر: {ad.cta_text}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(ad)}>
                    {ad.is_active ? 'إلغاء التفعيل' : 'تفعيل'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openForm(ad)}>
                    تعديل
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => deleteAd(ad.id)}>
                    حذف
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {isFormOpen && (
        <AdFormModal
          ad={editingId ? ads.find((a) => a.id === editingId) : undefined}
          form={form}
          setForm={setForm}
          submitting={submitting}
          onClose={closeForm}
          onSubmit={handleSubmit}
        />
      )}
    </DashboardSection>
  );
}

function AdFormModal({
  ad,
  form,
  setForm,
  submitting,
  onClose,
  onSubmit,
}: {
  ad?: Ad;
  form: Partial<Ad>;
  setForm: (f: Partial<Ad>) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <h2 className="text-xl font-bold text-white">{ad ? 'تعديل الإعلان' : 'إنشاء إعلان جديد'}</h2>
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">العنوان</label>
            <input
              type="text"
              required
              value={form.title ?? ''}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">الوصف (اختياري)</label>
            <textarea
              value={form.description ?? ''}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">رابط الصورة (اختياري)</label>
            <input
              type="url"
              value={form.image_url ?? ''}
              onChange={(e) => setForm({ ...form, image_url: e.target.value || null })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">نص زر CTA</label>
            <input
              type="text"
              value={form.cta_text ?? ''}
              onChange={(e) => setForm({ ...form, cta_text: e.target.value })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">رابط CTA</label>
            <input
              type="text"
              value={form.cta_link ?? ''}
              onChange={(e) => setForm({ ...form, cta_link: e.target.value || null })}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
              placeholder="/book?slug=my-clinic"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_active ?? true}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              id="is_active"
              className="h-4 w-4 rounded border-slate-600 text-cyan-500 focus:ring-cyan-500"
            />
            <label htmlFor="is_active" className="text-sm text-slate-300">نشط</label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
              إلغاء
            </Button>
            <Button variant="primary" type="submit" loading={submitting}>
              {ad ? 'حفظ' : 'إنشاء'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
