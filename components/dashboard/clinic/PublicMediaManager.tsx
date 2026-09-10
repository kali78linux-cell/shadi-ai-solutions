'use client';

import { useEffect, useState, useCallback } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * CLINIC PUBLIC MEDIA MANAGER — owner upload/preview/reorder/visibility/delete.
 *
 * Everything is tenant-scoped server-side: POST/PATCH/DELETE run behind
 * authorizeClinicRequest (ADMIN_ROLES) and the storage path is built from the
 * authenticated clinic_id. Row metadata lives in clinic_public_media (RLS).
 */

type MediaItem = {
  id: string;
  media_type: 'image' | 'video';
  public_url: string;
  title: string | null;
  caption: string | null;
  alt_text: string | null;
  display_order: number;
  enabled: boolean;
};

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
const SIZE_LIMIT_MB = 25;

export default function PublicMediaManager() {
  const { clinicId, authHeaders } = useClinicContext();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [altText, setAltText] = useState('');

  const load = useCallback(async () => {
    if (!clinicId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/clinic/public-media?clinic_id=${encodeURIComponent(clinicId)}`,
        { headers }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `فشل التحميل (${res.status})`);
      }
      const { data } = (await res.json()) as { data: MediaItem[] };
      setItems(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الوسائط');
    } finally {
      setLoading(false);
    }
  }, [clinicId, authHeaders]);

  useEffect(() => {
    if (clinicId) void load();
  }, [clinicId, load]);

  const upload = async (file: File) => {
    if (!clinicId) return;
    if (file.size > SIZE_LIMIT_MB * 1024 * 1024) {
      setError(`حجم الملف يتجاوز الحد الأقصى (${SIZE_LIMIT_MB}MB)`);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeaders();
      const form = new FormData();
      form.append('file', file);
      if (title.trim()) form.append('title', title.trim());
      if (altText.trim()) form.append('alt_text', altText.trim());
      const res = await fetch(
        `/api/clinic/public-media?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: 'POST', headers, body: form }
      );
      const body = (await res.json().catch(() => null)) as { data?: MediaItem; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `فشل الرفع (${res.status})`);
      setTitle('');
      setAltText('');
      setSuccess('تم رفع الملف بنجاح');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر رفع الملف');
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, patchBody: Record<string, unknown>) => {
    if (!clinicId) return;
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/clinic/public-media/${id}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(patchBody) }
      );
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'فشل الحفظ');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حفظ التغيير');
    }
  };

  const remove = async (id: string) => {
    if (!clinicId || !window.confirm('حذف هذا الملف نهائيًا من الصفحة العامة؟')) return;
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/clinic/public-media/${id}?clinic_id=${encodeURIComponent(clinicId)}`,
        { method: 'DELETE', headers }
      );
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'فشل الحذف');
      setSuccess('تم حذف الملف');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حذف الملف');
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    if (!items) return;
    const idx = items.findIndex((i) => i.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= items.length) return;
    void patch(id, { display_order: items[target].display_order });
    void patch(items[target].id, { display_order: items[idx].display_order });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-base font-semibold text-slate-800">معرض الصور والوسائط</h3>
      <p className="mt-0.5 text-sm text-slate-500">
        ارفع صورًا وفيديو تظهر في «معرض الأعمال» بالصفحة العامة. الحد الأقصى {SIZE_LIMIT_MB}MB لكل ملف (JPG/PNG/WebP/GIF — MP4/WebM/MOV).
      </p>

      {error ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {success ? <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p> : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">عنوان (اختياري)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="مثال: استقبال العيادة"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">نص بديل للصورة (اختياري)</span>
          <input
            type="text"
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="وصف قصير للصورة"
          />
        </label>
      </div>

      <label className="mt-3 flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm font-medium text-slate-600 transition hover:border-cyan-400 hover:bg-cyan-50">
        {busy ? 'جارٍ الرفع…' : '⬆ ارفع صورة أو فيديو'}
        <input
          type="file"
          accept={ACCEPT}
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </label>

      {loading ? (
        <p className="mt-4 text-sm text-slate-400">جارٍ التحميل…</p>
      ) : items && items.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <li key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="aspect-[4/3] w-full bg-slate-100">
                {item.media_type === 'video' ? (
                  <video src={item.public_url} controls preload="none" className="h-full w-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.public_url} alt={item.alt_text || item.title || 'صورة'} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-medium text-slate-700">{item.title || 'بدون عنوان'}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {item.media_type === 'image' ? 'صورة' : 'فيديو'} · الشرائح {index + 1}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <button type="button" onClick={() => move(item.id, -1)} disabled={index === 0} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    لأعلى
                  </button>
                  <button type="button" onClick={() => move(item.id, 1)} disabled={index === items.length - 1} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                    لأسفل
                  </button>
                  <button
                    type="button"
                    onClick={() => void patch(item.id, { enabled: !item.enabled })}
                    className={`rounded-md px-2 py-1 ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                  >
                    {item.enabled ? 'ظاهر' : 'مخفي'}
                  </button>
                  <button type="button" onClick={() => void remove(item.id)} className="rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50">
                    حذف
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
          لا توجد وسائط بعد. ارفع صورًا أو فيديو لتظهر في معرض الصفحة العامة.
        </p>
      )}
    </section>
  );
}