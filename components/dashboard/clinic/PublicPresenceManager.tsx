'use client';

import { useEffect, useState } from 'react';
import { Globe, User, Camera, FileText, ExternalLink, Stethoscope } from 'lucide-react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';

/**
 * PP-8B-i — "الحضور العام" management section. Owner/manager edits are
 * enforced by the API (ADMIN_ROLES); this UI is honest-by-design: everything
 * reflects real provider fields, no fabricated claims.
 */

type ProviderRow = {
  id: string;
  name: string;
  provider_type: string;
  public_visibility: 'private' | 'noindex' | 'indexable';
  public_slug: string | null;
  specialty: string | null;
  bio: string | null;
  photo_url: string | null;
};

type VisibilityState = {
  clinic: { discovery_enabled: boolean };
  providers: ProviderRow[];
};

const PUBLISHABLE_TYPES = ['dentist', 'specialist', 'hygienist'];
const VISIBILITY_LABELS: Record<ProviderRow['public_visibility'], string> = {
  private: 'خاص — غير ظاهر',
  noindex: 'ظاهر بالرابط فقط',
  indexable: 'ظاهر وقابل للفهرسة',
};

export default function PublicPresenceManager() {
  const { isConfigured, checkFailed } = useSupabaseConfig();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [state, setState] = useState<VisibilityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { specialty: string; bio: string; photo_url: string }>>({});

  async function load() {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/public-visibility?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? 'تعذر تحميل بيانات الحضور العام');
      const data = body.data as VisibilityState;
      setState(data);
      setDrafts(Object.fromEntries(
        data.providers.map((p) => [p.id, { specialty: p.specialty ?? '', bio: p.bio ?? '', photo_url: p.photo_url ?? '' }])
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isConfigured && !checkFailed) { setLoading(false); return; }
    if (clinicLoading) { setLoading(true); return; }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, clinicLoading, clinicId]);

  async function patch(body: Record<string, unknown>, providerId: string | null) {
    if (!clinicId) return;
    setSavingId(providerId ?? 'clinic');
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/public-visibility?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody?.error ?? 'تعذر الحفظ');
      setSavedId(providerId ?? 'clinic');
      setTimeout(() => setSavedId(null), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الحفظ');
    } finally {
      setSavingId(null);
    }
  }

  if (!isConfigured && !checkFailed) return null;
  if (loading || clinicLoading) return <Skeleton className="h-48 w-full" />;
  if (clinicError) return <EmptyState title="تعذر تحميل الحضور العام" description={clinicError} />;
  if (error && !state) return <EmptyState title="تعذر تحميل الحضور العام" description={error} />;
  if (!state) return null;

  return (
    <section className="rounded-xl border border-stone-800 bg-stone-900 p-5">
      <header className="mb-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Globe className="h-5 w-5 text-teal-300" /> الحضور العام
        </h3>
        <p className="mt-1 text-sm text-stone-400">
          حضورك المهني أمام المرضى على الإنترنت: صفحة طبيب عامة بتصميم احترافي تُظهر تخصصك
          وخدماتك ومكان عملك — كل معلومة تكتملها هنا تجعل حضورك أفضل.
        </p>
      </header>

      {error && <p className="mb-3 rounded-lg border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>}

      <label className="mb-5 flex items-start justify-between gap-3 rounded-lg border border-stone-800 bg-stone-950 p-4">
        <span>
          <span className="block text-sm font-semibold text-stone-100">ظهور العيادة في دليل الأطباء العام</span>
          <span className="mt-1 block text-xs text-stone-500">
            يتحكم بمظهر العيادة في الدليل العام فقط — لا يغيّر صفحة العيادة أو الحجز أو المحادثة. (للمالك/المدير)
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 accent-teal-500"
          checked={state.clinic.discovery_enabled}
          onChange={(e) => patch({ discovery_enabled: e.target.checked }, null)}
          disabled={savingId === 'clinic'}
        />
      </label>

      {state.providers.length === 0 ? (
        <EmptyState title="لا يوجد أطباء بعد" description="أضف طبيبًا من قسم مقدمي الخدمة لتبدأ حضوره المهني العام." />
      ) : (
        <ul className="space-y-4">
          {state.providers.map((p) => {
            const publishable = PUBLISHABLE_TYPES.includes(p.provider_type);
            const draft = drafts[p.id] ?? { specialty: '', bio: '', photo_url: '' };
            const completed = [p.photo_url, p.bio, p.specialty].filter(Boolean).length;
            return (
              <li key={p.id} className="rounded-lg border border-stone-800 bg-stone-950 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-stone-500" />
                    <span className="font-semibold text-stone-100">{p.name}</span>
                    <span className="rounded-full border border-stone-700 px-2 py-0.5 text-xs text-stone-400">
                      {p.provider_type}
                    </span>
                    {!publishable && (
                      <span className="rounded-full border border-stone-800 px-2 py-0.5 text-xs text-stone-600">
                        غير قابل للنشر العام
                      </span>
                    )}
                  </div>
                  <span className={`text-xs ${completed === 3 ? 'text-teal-300' : 'text-stone-500'}`}>
                    اكتمال الحضور: {completed}/3
                  </span>
                </div>
                {publishable ? (
                  <PublicPresenceFields
                    provider={p}
                    draft={draft}
                    saving={savingId === p.id}
                    saved={savedId === p.id}
                    onDraft={(next) => setDrafts((d) => ({ ...d, [p.id]: next }))}
                    onSaveProfile={() => patch({
                      provider_id: p.id,
                      profile: { specialty: draft.specialty || null, bio: draft.bio || null, photo_url: draft.photo_url || null },
                    }, p.id)}
                    onVisibility={(v) => patch({ provider_id: p.id, visibility: v }, p.id)}
                  />
                ) : (
                  <p className="text-xs text-stone-600">
                    هذا النوع من مقدمي الخدمة لا يُنشر للعام — تظهر هوياته داخل العيادة فقط.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PublicPresenceFields({
  provider,
  draft,
  saving,
  saved,
  onDraft,
  onSaveProfile,
  onVisibility,
}: {
  provider: ProviderRow;
  draft: { specialty: string; bio: string; photo_url: string };
  saving: boolean;
  saved: boolean;
  onDraft: (next: { specialty: string; bio: string; photo_url: string }) => void;
  onSaveProfile: () => void;
  onVisibility: (v: ProviderRow['public_visibility']) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-stone-400">
          <span className="mb-1 flex items-center gap-1"><Stethoscope className="h-3 w-3" /> التخصص</span>
          <input
            type="text"
            maxLength={120}
            className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100"
            placeholder="مثال: تقويم الأسنان"
            value={draft.specialty}
            onChange={(e) => onDraft({ ...draft, specialty: e.target.value })}
          />
        </label>
        <label className="block text-xs text-stone-400">
          <span className="mb-1 flex items-center gap-1"><Camera className="h-3 w-3" /> رابط الصورة (http/https)</span>
          <input
            type="url"
            dir="ltr"
            maxLength={600}
            className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100"
            placeholder="https://…"
            value={draft.photo_url}
            onChange={(e) => onDraft({ ...draft, photo_url: e.target.value })}
          />
        </label>
      </div>
      <label className="mt-3 block text-xs text-stone-400">
        <span className="mb-1 flex items-center gap-1"><FileText className="h-3 w-3" /> النبذة المهنية</span>
        <textarea
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100"
          placeholder="نبذة قصيرة تُعرّف المريض بك وخبرتك وأسلوب عملك"
          value={draft.bio}
          onChange={(e) => onDraft({ ...draft, bio: e.target.value })}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <select
          className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100"
          value={provider.public_visibility}
          onChange={(e) => onVisibility(e.target.value as ProviderRow['public_visibility'])}
          disabled={saving}
        >
          {Object.entries(VISIBILITY_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          className="rounded-md bg-teal-500 px-4 py-2 text-sm font-semibold text-stone-900 transition hover:bg-teal-400 disabled:opacity-50"
          onClick={onSaveProfile}
          disabled={saving}
        >
          {saving ? 'جارٍ الحفظ…' : saved ? 'تم الحفظ ✓' : 'حفظ الملف العام'}
        </button>
        {provider.public_slug && (
          <span className="flex items-center gap-1 text-xs text-stone-500" dir="ltr">
            <ExternalLink className="h-3 w-3" /> /d/{provider.public_slug}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-600">
        الرابط العام يُنشأ مرة واحدة ويبقى ثابتًا ويقود إلى صفحة الطبيب العامة (PP-8B-ii)
        المبنية تلقائيًا عند إنشاء هذا الملف. <a className="underline" href={`/d/${provider.public_slug ?? ''}`}>معاينة الصفحة</a> — تظهر فقط للمقدمين
        غير الخاصين (per visibility) ولا تُنشأ للأنواع الخاصة.
      </p>
    </>
  );
}
