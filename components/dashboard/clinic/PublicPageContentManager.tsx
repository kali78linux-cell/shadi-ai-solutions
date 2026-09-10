'use client';

/**
 * PHASE L — PUBLIC PAGE CONTENT manager.
 * Tabs: المظهر (theme) + content types (achievements / testimonials /
 * articles / news ticker). Theme persists through the existing
 * /api/clinic/public-page PATCH (clinics.settings.public_profile.theme);
 * content persists through /api/clinic/public-content CRUD.
 * Everything is tenant-scoped via useClinicContext clinicId + authHeaders.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import Skeleton from '@/components/ui/Skeleton';

type ContentType = 'achievements' | 'testimonials' | 'articles' | 'news';
type TabId = 'theme' | ContentType;

const TYPE_LABELS: Record<ContentType, string> = {
  achievements: 'الإنجازات',
  testimonials: 'شهادات المرضى',
  articles: 'المقالات',
  news: 'شريط الأخبار',
};

const TAB_ORDER: TabId[] = ['theme', 'achievements', 'testimonials', 'articles', 'news'];

type ThemeForm = {
  primary_color: string;
  background_color: string;
  text_color: string;
  button_shape: 'pill' | 'rounded' | 'squared';
  button_size: 'small' | 'medium' | 'large';
  button_shadow: boolean;
  button_zoom: boolean;
};

const DEFAULT_THEME: ThemeForm = {
  primary_color: '#0e7490',
  background_color: '#f6f8ff',
  text_color: '#0f172a',
  button_shape: 'pill',
  button_size: 'medium',
  button_shadow: true,
  button_zoom: true,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

/** PHASE L — bounded theme editor. Hex colors only; enums mapped to approved values. */
function ThemeEditor({
  value,
  onChange,
  saving,
}: {
  value: ThemeForm;
  onChange: (next: ThemeForm) => void;
  saving: boolean;
}) {
  const set = (k: keyof ThemeForm, v: unknown) => onChange({ ...value, [k]: v });
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="اللون الأساسي (الأزرار والعناصر الرئيسية)">
        <div className="flex items-center gap-2">
          <input type="color" value={value.primary_color} onChange={(e) => set('primary_color', e.target.value)} className="h-9 w-14 rounded border border-slate-200" />
          <input type="text" value={value.primary_color} onChange={(e) => set('primary_color', e.target.value)} className={inputCls} dir="ltr" />
        </div>
      </Field>
      <Field label="لون الخلفية">
        <div className="flex items-center gap-2">
          <input type="color" value={value.background_color} onChange={(e) => set('background_color', e.target.value)} className="h-9 w-14 rounded border border-slate-200" />
          <input type="text" value={value.background_color} onChange={(e) => set('background_color', e.target.value)} className={inputCls} dir="ltr" />
        </div>
      </Field>
      <Field label="لون النصوص">
        <div className="flex items-center gap-2">
          <input type="color" value={value.text_color} onChange={(e) => set('text_color', e.target.value)} className="h-9 w-14 rounded border border-slate-200" />
          <input type="text" value={value.text_color} onChange={(e) => set('text_color', e.target.value)} className={inputCls} dir="ltr" />
        </div>
      </Field>
      <Field label="شكل الأزرار">
        <select value={value.button_shape} onChange={(e) => set('button_shape', e.target.value)} className={inputCls}>
          <option value="pill">فقاعي (دائري بالكامل)</option>
          <option value="rounded">بيضاوي (زوايا ناعمة)</option>
          <option value="squared">مربع (زوايا خفيفة)</option>
        </select>
      </Field>
      <Field label="حجم الأزرار">
        <select value={value.button_size} onChange={(e) => set('button_size', e.target.value)} className={inputCls}>
          <option value="small">صغير</option>
          <option value="medium">متوسط</option>
          <option value="large">كبير</option>
        </select>
      </Field>
      <div className="flex items-end gap-6 pb-1">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value.button_shadow} onChange={(e) => set('button_shadow', e.target.checked)} className="h-4 w-4" />
          ظل للأزرار
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value.button_zoom} onChange={(e) => set('button_zoom', e.target.checked)} className="h-4 w-4" />
          حركة تكبير عند التمرير
        </label>
        {saving && <span className="text-xs text-slate-400">جارٍ الحفظ…</span>}
      </div>
    </div>
  );
}

type FieldDef =
  | { kind: 'text'; key: string; label: string; max: number; required?: boolean; placeholder?: string }
  | { kind: 'textarea'; key: string; label: string; max: number; required?: boolean; placeholder?: string }
  | { kind: 'number'; key: string; label: string; min: number; max: number }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'color'; key: string; label: string };

type ItemRow = Record<string, unknown> & { id: string; enabled?: boolean; display_order?: number };

const FONT_OPTIONS = [
  { value: 'small', label: 'صغير' },
  { value: 'medium', label: 'متوسط' },
  { value: 'large', label: 'كبير' },
];
const SPEED_OPTIONS = [
  { value: 'slow', label: 'بطيء' },
  { value: 'medium', label: 'متوسط' },
  { value: 'fast', label: 'سريع' },
];

const FIELDS: Record<ContentType, FieldDef[]> = {
  achievements: [
    { kind: 'text', key: 'title', label: 'العنوان', max: 120, required: true },
    { kind: 'text', key: 'value', label: 'القيمة / الرقم', max: 60, required: true, placeholder: 'مثل: +2,000' },
    { kind: 'text', key: 'icon', label: 'الأيقونة (إيموجي)', max: 8 },
    { kind: 'color', key: 'background_color', label: 'لون الخلفية' },
    { kind: 'select', key: 'font_size', label: 'حجم الخط', options: FONT_OPTIONS },
  ],
  testimonials: [
    { kind: 'text', key: 'patient_name', label: 'اسم المريض', max: 120, required: true },
    { kind: 'textarea', key: 'content', label: 'نص الشهادة', max: 2000, required: true },
    { kind: 'number', key: 'rating', label: 'التقييم (1-5)', min: 1, max: 5 },
  ],
  articles: [
    { kind: 'text', key: 'title', label: 'عنوان المقال', max: 200, required: true },
    { kind: 'textarea', key: 'content', label: 'المحتوى', max: 10000 },
    { kind: 'text', key: 'category', label: 'الفئة', max: 80 },
    { kind: 'color', key: 'title_color', label: 'لون العنوان' },
    { kind: 'select', key: 'font_size', label: 'حجم الخط', options: FONT_OPTIONS },
  ],
  news: [
    { kind: 'text', key: 'text', label: 'نص الخبر', max: 300, required: true },
    { kind: 'text', key: 'link', label: 'الرابط (اختياري)', max: 600 },
    { kind: 'number', key: 'priority', label: 'الأولوية (0-1000)', min: 0, max: 1000 },
    { kind: 'select', key: 'speed', label: 'سرعة الحركة', options: SPEED_OPTIONS },
    { kind: 'color', key: 'background_color', label: 'لون الخلفية' },
    { kind: 'color', key: 'text_color', label: 'لون النص' },
  ],
};

function uiValue(item: ItemRow, key: string): string {
  const v = item[key];
  if (v === null || v === undefined) return '';
  return String(v);
}

function buildPayload(fields: FieldDef[], form: Record<string, string | boolean | number>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = form[f.key];
    if (v === undefined || v === '') continue;
    if (f.kind === 'number') out[f.key] = Number(v);
    else if (f.kind === 'color') out[f.key] = v;
    else out[f.key] = String(v);
  }
  return out;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  switch (field.kind) {
    case 'textarea':
      return <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={field.max} rows={4} className={inputCls} placeholder={field.placeholder} />;
    case 'number':
      return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} min={field.min} max={field.max} className={inputCls} />;
    case 'select':
      return (
        <select value={value || (field.options[0]?.value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#0e7490'} onChange={(e) => onChange(e.target.value)} className="h-9 w-14 rounded border border-slate-200" />
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} dir="ltr" />
        </div>
      );
    default:
      return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} maxLength={field.max} className={inputCls} placeholder={field.placeholder} />;
  }
}

type ManagerApi = { clinicId: string; authHeaders: () => Promise<Record<string, string>> };

/** Ratings stars for testimonials. */
function Stars({ rating }: { rating: number }) {
  return <span className="text-amber-400" dir="ltr">{'★'.repeat(Math.max(1, Math.min(5, rating)))}</span>;
}
export function ContentEditor({ type, api }: { type: ContentType; api: ManagerApi }) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean | number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string | boolean | number>>({});
  const [uploading, setUploading] = useState(false);

  const fields = FIELDS[type];

  const load = useCallback(async () => {
    if (!api.clinicId) return;
    try {
      const headers = await api.authHeaders();
      const res = await fetch(`/api/clinic/public-content?clinic_id=${encodeURIComponent(api.clinicId)}&type=${type}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Failed to load (${res.status})`);
      }
      const { data } = (await res.json()) as { data: ItemRow[] };
      setItems(data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المحتوى');
    } finally {
      setLoading(false);
    }
  }, [api, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadImage = async (file: File): Promise<{ image_path: string; image_url: string } | null> => {
    if (!api.clinicId || !file) return null;
    setUploading(true);
    try {
      const headers = await api.authHeaders();
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/clinic/public-content/upload?clinic_id=${encodeURIComponent(api.clinicId)}`, {
        method: 'POST',
        headers,
        body,
      });
      const json = (await res.json().catch(() => null)) as { data?: { path: string; url: string }; error?: string } | null;
      if (!res.ok || !json?.data) {
        throw new Error(json?.error ?? 'تعذر رفع الصورة');
      }
      return { image_path: json.data.path, image_url: json.data.url };
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر رفع الصورة');
      return null;
    } finally {
      setUploading(false);
    }
  };

  const createSave = async () => {
    if (!api.clinicId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await api.authHeaders();
      const res = await fetch(`/api/clinic/public-content?clinic_id=${encodeURIComponent(api.clinicId)}&type=${type}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ...buildPayload(fields, form) }),
      });
      const json = (await res.json().catch(() => null)) as { data?: ItemRow; error?: string } | null;
      if (!res.ok || !json?.data) throw new Error(json?.error ?? 'تعذر الإضافة');
      setItems((prev) => [...prev, { ...json.data as ItemRow }]);
      setForm({});
      setAdding(false);
      setSuccess('تمت الإضافة بنجاح');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الإضافة');
    } finally {
      setSaving(false);
    }
  };

  const updateSave = async (id: string) => {
    if (!api.clinicId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await api.authHeaders();
      const res = await fetch(`/api/clinic/public-content/${id}?clinic_id=${encodeURIComponent(api.clinicId)}&type=${type}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...buildPayload(fields, editForm) }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? 'تعذر التحديث');
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...buildPayload(fields, editForm) } : it)));
      setEditingId(null);
      setEditForm({});
      setSuccess('تم حفظ التغييرات');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التحديث');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (item: ItemRow) => {
    if (!api.clinicId) return;
    try {
      const headers = await api.authHeaders();
      const res = await fetch(`/api/clinic/public-content/${item.id}?clinic_id=${encodeURIComponent(api.clinicId)}&type=${type}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, enabled: !item.enabled }),
      });
      if (!res.ok) return;
      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, enabled: !item.enabled } : it)));
    } catch {
      /* keep state unchanged on network failure */
    }
  };

  const deleteItem = async (id: string) => {
    if (!api.clinicId) return;
    if (!window.confirm('هل أنت متأكد من الحذف؟')) return;
    setSaving(true);
    setError(null);
    try {
      const headers = await api.authHeaders();
      const res = await fetch(`/api/clinic/public-content/${id}?clinic_id=${encodeURIComponent(api.clinicId)}&type=${type}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) return;
      setItems((prev) => prev.filter((it) => it.id !== id));
      setSuccess('تم الحذف');
    } catch {
      setError('تعذر الحذف');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: ItemRow) => {
    setEditingId(item.id);
    const initial: Record<string, string | boolean | number> = {};
    for (const f of fields) {
      initial[f.key] = uiValue(item, f.key);
    }
    setEditForm(initial);
  };

  const emptyForm = () => {
    const initial: Record<string, string | boolean | number> = {};
    for (const f of fields) {
      if (f.kind === 'select') initial[f.key] = f.options[0]?.value ?? '';
      if (f.kind === 'color') initial[f.key] = '#0e7490';
      if (f.kind === 'number') initial[f.key] = f.min;
    }
    return initial;
  };

  const fieldGrid = (current: Record<string, string | boolean | number>, set: (v: Record<string, string | boolean | number>) => void) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.key} label={f.label}>
          <FieldInput
            field={f}
            value={String(current[f.key] ?? '')}
            onChange={(v) => set({ ...current, [f.key]: v })}
          />
        </Field>
      ))}
      {(type === 'testimonials' || type === 'articles') && (
        <Field label={type === 'testimonials' ? 'صورة المريض (اختياري)' : 'صورة المقال (اختياري)'}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const uploaded = await uploadImage(file);
              if (uploaded) {
                set({ ...current, image_path: uploaded.image_path, image_url: uploaded.image_url });
              }
            }}
            className="w-full text-sm"
          />
          {String(current.image_url ?? '').length > 0 && (
            <span className="mt-1 block text-xs text-emerald-600">✓ تم رفع صورة</span>
          )}
        </Field>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}

      {adding ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h4 className="mb-3 text-sm font-semibold text-slate-800">إضافة {TYPE_LABELS[type]}</h4>
          {fieldGrid(form, setForm)}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void createSave()}
              disabled={saving || uploading}
              className="rounded-full bg-brand-cyan px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-cyan/90 disabled:opacity-50"
            >
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600">
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm());
            setAdding(true);
          }}
          className="rounded-full border border-brand-cyan/40 bg-brand-cyan/5 px-4 py-2 text-sm font-semibold text-brand-cyan transition hover:bg-brand-cyan/10"
        >
          + إضافة {TYPE_LABELS[type]}
        </button>
      )}

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          لا يوجد أي {TYPE_LABELS[type]} بعد — أضف أول عنصر من الزر أعلاه، ثم فعّل قسمه في الصفحة من «أقسام الصفحة».
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
              {editingId === item.id ? (
                <div>
                  {fieldGrid(editForm, setEditForm)}
                  <div className="mt-3 flex items-center gap-2">
                    <button type="button" onClick={() => void updateSave(item.id)} disabled={saving} className="rounded-full bg-brand-cyan px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {saving ? 'جارٍ الحفظ…' : 'حفظ التعديل'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600">
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 text-sm text-slate-700">
                    {type === 'achievements' && (
                      <span className="flex items-center gap-2 font-semibold">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: String(item.background_color ?? '#0e7490') }} />
                        {String(item.icon ?? '')} {String(item.title ?? '')} — {String(item.value ?? '')}
                      </span>
                    )}
                    {type === 'testimonials' && (
                      <span className="block truncate font-semibold">
                        {String(item.patient_name ?? '')} <Stars rating={Number(item.rating ?? 5)} />
                      </span>
                    )}
                    {type === 'articles' && (
                      <span className="block truncate font-semibold">
                        {String(item.title ?? '')} {item.category != null ? `· ${String(item.category)}` : ''}
                      </span>
                    )}
                    {type === 'news' && (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: String(item.background_color ?? '#0e7490') }} />
                        <span className="truncate">{String(item.text ?? '')}</span>
                        {item.link != null && <span className="text-xs text-slate-400">🔗</span>}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      <input type="checkbox" checked={item.enabled !== false} onChange={() => void toggleEnabled(item)} className="h-4 w-4" />
                      ظاهر
                    </label>
                    <button type="button" onClick={() => startEdit(item)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-cyan/50">
                      تعديل
                    </button>
                    <button type="button" onClick={() => void deleteItem(item.id)} className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                      حذف
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PublicPageContentManager() {
  const { isConfigured, checkFailed } = useSupabaseConfig();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [tab, setTab] = useState<TabId>('theme');
  const [theme, setTheme] = useState<ThemeForm>(DEFAULT_THEME);
  const [themeSaving, setThemeSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const api: ManagerApi = useMemo(() => ({ clinicId: clinicId ?? '', authHeaders }), [clinicId, authHeaders]);

  const loadTheme = useCallback(async () => {
    if (!clinicId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/public-page?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      if (!res.ok) return;
      const { data } = (await res.json()) as { data?: { theme?: Partial<ThemeForm> } };
      if (data?.theme) setTheme({ ...DEFAULT_THEME, ...data.theme });
    } catch {
      /* keep safe defaults on network failure */
    }
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (tab === 'theme') void loadTheme();
  }, [tab, loadTheme]);

  const saveTheme = async () => {
    if (!clinicId) return;
    setThemeSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/public-page?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      });
      const body = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'تعذر حفظ المظهر');
      setSuccess('تم حفظ المظهر — راجع صفحتك العامة');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ المظهر');
    } finally {
      setThemeSaving(false);
    }
  };

  if (!isConfigured && !checkFailed) return null;
  if (clinicLoading) return <Skeleton className="h-40 w-full" />;
  if (!clinicId) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        {clinicError ?? 'لا يوجد سياق عيادة — تأكد من اختيار المؤسسة أولاً'}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>}

      <div className="flex flex-wrap gap-2">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t ? 'bg-brand-cyan text-white shadow' : 'border border-slate-300 bg-white text-slate-600 hover:border-brand-cyan/50'
            }`}
          >
            {t === 'theme' ? '🎨 المظهر العام' : TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'theme' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-800">المظهر العام</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            ألوان هادئة، شكل وحجم الأزرار، الظل وحركة التكبير. تُحفظ ضمن إعدادات صفحتك العامة ولا تسمح بإدخال CSS حر.
          </p>
          <div className="mt-4">
            <ThemeEditor value={theme} onChange={setTheme} saving={themeSaving} />
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void saveTheme()}
              disabled={themeSaving}
              className="rounded-full bg-brand-cyan px-5 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-cyan/90 disabled:opacity-50"
            >
              {themeSaving ? 'جارٍ الحفظ…' : 'حفظ المظهر'}
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-800">{TYPE_LABELS[tab]}</h3>
          <p className="mt-0.5 text-sm text-slate-500">أدر المحتوى من هنا، ثم فعّل القسم من «أقسام الصفحة» في إدارة الصفحة العامة.</p>
          <div className="mt-4">
            <ContentEditor type={tab} api={api} />
          </div>
        </section>
      )}
    </div>
  );
}
