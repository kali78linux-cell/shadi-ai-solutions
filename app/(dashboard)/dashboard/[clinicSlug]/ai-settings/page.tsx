'use client';

import { FormEvent, useEffect, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';

type AISettings = {
  assistant_name?: string | null;
  tone?: string | null;
  language?: string | null;
  greeting?: string | null;
  lead_detection_enabled?: boolean | null;
  policies?: {
    booking?: string | null;
    cancellation?: string | null;
    rescheduling?: string | null;
    emergency?: string | null;
    payment_methods?: string | null;
  } | null;
  appointment_booking_enabled?: boolean | null;
  knowledge_retrieval_enabled?: boolean | null;
  confidence_threshold?: number | null;
  safety_controls?: Record<string, unknown> | null;
};

function aiSettingsErrorMessage(status?: number): string {
  if (status === 401) return 'انتهت جلسة تسجيل الدخول. سجّل الدخول مرة أخرى.';
  if (status === 403) return 'لا تملك صلاحية تعديل إعدادات الذكاء الاصطناعي لهذه العيادة.';
  if (status === 400) return 'تعذر حفظ الإعدادات: تحقّق من القيم المدخلة.';
  return 'تعذر حفظ إعدادات الذكاء الاصطناعي. حاول مرة أخرى.';
}

export default function AISettingsPage() {
  const { isConfigured: isSupabaseConfigured, checkFailed } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<AISettings>({});

  async function loadSettings(id: string) {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/ai-settings?clinic_id=${encodeURIComponent(id)}`, { headers });
      if (!res.ok) throw new Error(aiSettingsErrorMessage(res.status));
      const payload = await res.json();
      const data = payload?.data ?? {};
      setSettings({
        assistant_name: data.assistant_name ?? 'موظفة الاستقبال الذكية',
        tone: data.tone ?? 'friendly',
        language: data.language ?? 'ar',
        greeting: data.greeting ?? 'مرحبًا! كيف يمكنني مساعدتك؟',
        lead_detection_enabled: data.lead_detection_enabled ?? true,
        appointment_booking_enabled: data.appointment_booking_enabled ?? true,
        knowledge_retrieval_enabled: data.knowledge_retrieval_enabled ?? true,
        confidence_threshold: data.confidence_threshold ?? 0.25,
        safety_controls: data.safety_controls ?? {},
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر تحميل إعدادات الذكاء الاصطناعي.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured && !checkFailed) { setLoading(false); return; }
    if (clinicLoading) { setLoading(true); return; }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void loadSettings(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicId) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/ai-settings?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error(aiSettingsErrorMessage(res.status));
      const payload = await res.json();
      setSettings((current) => ({ ...current, ...(payload?.data ?? {}) }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر حفظ إعدادات الذكاء الاصطناعي. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardSection title="إعدادات الذكاء الاصطناعي" subtitle="تحكم بسلوك المساعد ونبرته والترحيب واللغات وقواعد العمل.">
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : !isSupabaseConfigured && !checkFailed ? (
        <EmptyState title="Supabase غير مهيأ" description="فعّل بيئة العيادة الخلفية لتحميل إعدادات الذكاء الاصطناعي وحفظها." />
      ) : error ? (
        <EmptyState title="إعدادات الذكاء الاصطناعي غير متاحة" description={error} />
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">اسم المساعد</label>
              <input
                value={settings.assistant_name ?? ''}
                onChange={(e) => setSettings((current) => ({ ...current, assistant_name: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">النبرة والشخصية</label>
              <select
                value={settings.tone ?? 'friendly'}
                onChange={(e) => setSettings((current) => ({ ...current, tone: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="friendly">ودود</option>
                <option value="professional">احترافي</option>
                <option value="warm">دافئ</option>
                <option value="concise">مختصر</option>
              </select>
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">اللغة</label>
              <select
                value={settings.language ?? 'ar'}
                onChange={(e) => setSettings((current) => ({ ...current, language: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="ar">العربية</option>
                <option value="en">الإنجليزية</option>
                <option value="both">العربية والإنجليزية</option>
              </select>
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">حد الثقة</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={settings.confidence_threshold ?? 0.25}
                onChange={(e) => setSettings((current) => ({ ...current, confidence_threshold: Number(e.target.value) }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <label className="block text-sm text-slate-400">رسالة الترحيب</label>
            <textarea
              value={settings.greeting ?? ''}
              onChange={(e) => setSettings((current) => ({ ...current, greeting: e.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>اكتشاف العملاء المحتملين</span>
              <input
                type="checkbox"
                checked={settings.lead_detection_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, lead_detection_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>حجز المواعيد</span>
              <input
                type="checkbox"
                checked={settings.appointment_booking_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, appointment_booking_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>استرجاع المعرفة</span>
              <input
                type="checkbox"
                checked={settings.knowledge_retrieval_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, knowledge_retrieval_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
          </div>

          <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm font-semibold text-slate-200">سياسات العيادة</p>
            <p className="mt-1 text-xs text-slate-500">
              تظهر للذكاء الاصطناعي عند سؤال المرضى. اترك الحقل فارغاً إذا لم تُحدد السياسة بعد — سيتعامل المساعد بحذر ويحوّل للموظف عند الحاجة.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {([
                ['booking', 'سياسة الحجز'],
                ['cancellation', 'سياسة الإلغاء'],
                ['rescheduling', 'سياسة إعادة الجدولة'],
                ['emergency', 'حالات الطوارئ'],
                ['payment_methods', 'طرق الدفع المقبولة'],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="block text-sm text-slate-400">{label}</label>
                  <textarea
                    value={(settings.policies?.[key] as string) ?? ''}
                    onChange={(e) =>
                      setSettings((current) => ({
                        ...current,
                        policies: { ...(current.policies ?? {}), [key]: e.target.value || null },
                      }))
                    }
                    rows={2}
                    placeholder="غير محدد"
                    className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
              {saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}
            </button>
            {saved ? <span className="text-sm text-emerald-400">تم حفظ الإعدادات بنجاح.</span> : null}
            {error ? <span className="text-sm text-red-400">{error}</span> : null}
          </div>
        </form>
      )}
    </DashboardSection>
  );
}
