'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import Skeleton from '@/components/ui/Skeleton';
import PublicMediaManager from '@/components/dashboard/clinic/PublicMediaManager';

/**
 * CLINIC PUBLIC PAGE OWNER EXPERIENCE — owner screen for the clinic's public
 * page. Every field maps to clinics.settings.public_profile (JSONB) via
 * PATCH /api/clinic/public-page and is tenant-scoped (authorizeClinicRequest).
 *
 * Presentation-only: hiding a service/provider never touches booking eligibility.
 */

type PublicServiceItem = { id: string; name: string };
type PublicProviderItem = { id: string; name: string; title: string | null; specialty: string | null };

type PageConfig = {
  slug: string;
  public_id: string | null;
  pageUrl: string;
  description?: string;
  tagline?: string;
  about?: string;
  cover_url?: string;
  show_phone: boolean;
  show_prices: boolean;
  show_providers: boolean;
  discovery_enabled: boolean;
  social_links: { facebook?: string; instagram?: string; whatsapp?: string; website?: string };
  sections: Record<string, boolean>;
  hidden_services: string[];
  hidden_providers: string[];
  services: PublicServiceItem[];
  providers: PublicProviderItem[];
  hasAds: boolean;
  display?: Partial<{
    body_text: 'small' | 'medium' | 'large';
    heading: 'small' | 'medium' | 'large';
    section_title: 'small' | 'medium' | 'large';
    image_size: 'small' | 'medium' | 'large';
    video_size: 'small' | 'medium' | 'large';
    gallery_spacing: 'compact' | 'normal' | 'roomy';
  }>;
};

const SECTION_LABELS: Record<string, string> = {
  hero: 'الغلاف (Hero)',
  about: 'نبذة عن العيادة',
  services: 'الخدمات',
  providers: 'مقدمو الخدمة',
  hours: 'ساعات العمل',
  offers: 'العروض',
  gallery: 'الصور',
  contact: 'التواصل',
  bookingCta: 'زر الحجز',
  aiCta: 'زر المساعد الذكي',
  qrShare: 'QR / مشاركة',
  achievements: 'الإنجازات',
  testimonials: 'شهادات المرضى',
  articles: 'المقالات',
  news: 'شريط الأخبار',
};

const SOCIAL_LABELS: Record<string, string> = {
  whatsapp: 'واتساب',
  facebook: 'فيسبوك',
  instagram: 'انستغرام',
  website: 'الموقع الإلكتروني',
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export default function PublicPageManager() {
  const { isConfigured, checkFailed } = useSupabaseConfig();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [config, setConfig] = useState<PageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    description: '',
    tagline: '',
    about: '',
    cover_url: '',
    whatsapp: '',
    facebook: '',
    instagram: '',
    website: '',
  });

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/public-page?clinic_id=${encodeURIComponent(clinicId)}`, {
        headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load (${res.status})`);
      }
      const { data } = (await res.json()) as { data: PageConfig };
      setConfig(data);
      setForm({
        description: data.description ?? '',
        tagline: data.tagline ?? '',
        about: data.about ?? '',
        cover_url: data.cover_url ?? '',
        whatsapp: data.social_links?.whatsapp ?? '',
        facebook: data.social_links?.facebook ?? '',
        instagram: data.social_links?.instagram ?? '',
        website: data.social_links?.website ?? '',
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل إعدادات الصفحة العامة');
    } finally {
      setLoading(false);
    }
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (!isConfigured && !checkFailed) {
      setLoading(false);
      return;
    }
    if (clinicLoading) return;
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void load();
  }, [isConfigured, checkFailed, clinicLoading, clinicId, clinicError, load]);

  const update = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!clinicId) return;
      setSaving(true);
      setError(null);
      setSuccess(null);
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/clinic/public-page?clinic_id=${encodeURIComponent(clinicId)}`, {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const body = (await res.json().catch(() => null)) as { data?: PageConfig; error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? `فشل الحفظ (${res.status})`);
        if (body?.data) setConfig(body.data);
        setSuccess('تم حفظ التغييرات بنجاح');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر حفظ التغييرات');
      } finally {
        setSaving(false);
      }
    },
    [clinicId, authHeaders]
  );

  const saveInfo = () => {
    void update({
      description: form.description.trim() || null,
      tagline: form.tagline.trim() || null,
      about: form.about.trim() || null,
      cover_url: form.cover_url.trim() || null,
      social_links: {
        whatsapp: form.whatsapp.trim() || null,
        facebook: form.facebook.trim() || null,
        instagram: form.instagram.trim() || null,
        website: form.website.trim() || null,
      },
    }).then(() => load());
  };

  const toggleSection = (key: string, value: boolean) => {
    void update({ sections: { [key]: value } }).then(() => load());
  };

  const toggleService = (id: string) => {
    if (!config) return;
    const hidden = config.hidden_services.includes(id);
    const next = hidden
      ? config.hidden_services.filter((x) => x !== id)
      : [...config.hidden_services, id];
    void update({ hidden_services: next }).then(() => load());
  };

  const toggleProvider = (id: string) => {
    if (!config) return;
    const hidden = config.hidden_providers.includes(id);
    const next = hidden
      ? config.hidden_providers.filter((x) => x !== id)
      : [...config.hidden_providers, id];
    void update({ hidden_providers: next }).then(() => load());
  };

  const downloadQr = async () => {
    if (!config?.public_id) return;
    try {
      const res = await fetch(`/api/qr?public_id=${encodeURIComponent(config.public_id)}`);
      if (!res.ok) throw new Error('QR download failed');
      const svg = await res.text();
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clinic-qr-${config.slug}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('تم تنزيل رمز QR');
    } catch {
      setError('تعذر تنزيل رمز QR');
    }
  };

  const copyLink = async () => {
    if (!config) return;
    const url = `${window.location.origin}${config.pageUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      setSuccess('تم نسخ رابط الصفحة العامة');
    } catch {
      setError('تعذر نسخ الرابط');
    }
  };

  if (loading) return <Skeleton className="h-64 w-full" />;

  if (!isConfigured && !checkFailed) {
    return <p className="text-sm text-slate-500">تعذر التحقق من الإعدادات — حاول مرة أخرى لاحقًا.</p>;
  }

  if (!config) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-sm text-slate-600">{error ?? 'لا توجد بيانات للصفحة العامة.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>
      ) : null}
      {success ? (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700" role="status">{success}</p>
      ) : null}

      {/* Public page links + QR */}
      <Section title="صفحتك العامة" subtitle="رابط دائم يمكن مشاركته مع المرضى.">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={config.pageUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-blue-600 hover:underline">
                {config.pageUrl}
              </Link>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{config.slug}</span>
            </div>
            <button type="button" onClick={copyLink} className="text-sm text-slate-600 underline-offset-2 hover:underline">
              نسخ الرابط
            </button>
          </div>
          <div className="flex items-center gap-3">
            {config.public_id ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/qr?public_id=${encodeURIComponent(config.public_id)}`}
                alt="رمز QR للصفحة العامة"
                className="h-24 w-24 rounded-lg border border-slate-200"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                QR غير متاح
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button type="button" onClick={downloadQr} disabled={!config.public_id} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50">
                تنزيل QR
              </button>
              <Link
                href={config.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-slate-300 px-3 py-2 text-center text-sm text-slate-700 hover:bg-slate-50"
              >
                مشاهدة الصفحة العامة
              </Link>
            </div>
          </div>
        </div>
      </Section>
      {/* Branding + basic info */}
      <Section title="الهوية والنبذة" subtitle="الاسم والشعار والنبذة تظهر في الصفحة العامة.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">صورة الغلاف</span>
            <input
              type="text"
              value={form.cover_url}
              onChange={(e) => setForm((f) => ({ ...f, cover_url: e.target.value }))}
              placeholder="https://… (اختياري)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">شعار مختصر (Tagline)</span>
            <input
              type="text"
              value={form.tagline}
              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
              placeholder="جملة تعريفية قصيرة"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">نبذة قصيرة</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-700">عن العيادة</span>
            <textarea
              value={form.about}
              onChange={(e) => setForm((f) => ({ ...f, about: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={saveInfo}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'حفظ…' : 'حفظ النبذة'}
        </button>
      </Section>

      {/* Display controls — bounded enums mapped to approved classes by the renderer */}
      <Section title="مقاسات العرض" subtitle="تحكم في حجم النصوص والصور والفيديو في صفحتك العامة. القيم محدودة وآمنة ولا تؤثر على البنية.">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['body_text', 'حجم النص'],
              ['heading', 'حجم العناوين'],
              ['section_title', 'حجم عناوين الأقسام'],
              ['image_size', 'حجم الصور'],
              ['video_size', 'حجم الفيديو'],
              ['gallery_spacing', 'تباعد المعرض'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
              <select
                value={config.display?.[key] ?? (key === 'gallery_spacing' ? 'normal' : 'medium')}
                onChange={(e) => void update({ display: { [key]: e.target.value } }).then(() => load())}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {(['small', 'medium', 'large'] as const).map((v) => (
                  <option key={v} value={v}>
                    {v === 'small' ? 'صغير' : v === 'large' ? 'كبير' : 'متوسط'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Section>

      {/* Media gallery management — upload / preview / reorder / visibility / delete */}
      <PublicMediaManager />

      {/* Social links */}
      <Section title="روابط التواصل" subtitle="تظهر في قسم التواصل بالصفحة العامة.">
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[]).map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">{SOCIAL_LABELS[key]}</span>
              <input
                type="text"
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                placeholder={key === 'whatsapp' ? 'رقم واتساب' : 'https://…'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-6">
          <Toggle checked={config.show_phone} onChange={(v) => void update({ show_phone: v }).then(() => load())} label="إظهار رقم الهاتف" />
          <Toggle checked={config.show_prices} onChange={(v) => void update({ show_prices: v }).then(() => load())} label="إظهار الأسعار" />
        </div>
      </Section>

      {/* Sections / services / providers visibility */}
      <Section title="أقسام الصفحة" subtitle="أظهر أو أخفِ كل قسم. الأقسام المخفية لا تعرض محتوى فارغًا.">
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <Toggle key={key} checked={config.sections[key] ?? false} onChange={(v) => toggleSection(key, v)} label={label} />
          ))}
        </div>
      </Section>

      <Section title="الخدمات" subtitle="اختر الخدمات التي تظهر في الصفحة العامة. الإخفاء لا يؤثر على الحجز.">
        {config.services.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد خدمات نشطة بعد. أضف خدمات من صفحة «الخدمات».</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {config.services.map((s) => (
              <Toggle key={s.id} checked={!config.hidden_services.includes(s.id)} onChange={() => toggleService(s.id)} label={s.name} />
            ))}
          </div>
        )}
      </Section>

      <Section title="مقدمو الخدمة" subtitle="اختر من يظهر في الصفحة العامة. لا يؤثر على تخصيص الحجز.">
        {config.providers.length === 0 ? (
          <p className="text-sm text-slate-500">لا يوجد مقدمو خدمة بعد. أضفهم من صفحة «مقدمو الخدمة».</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {config.providers.map((p) => (
              <Toggle key={p.id} checked={!config.hidden_providers.includes(p.id)} onChange={() => toggleProvider(p.id)} label={`${p.name}${p.specialty ? ` — ${p.specialty}` : ''}`} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

