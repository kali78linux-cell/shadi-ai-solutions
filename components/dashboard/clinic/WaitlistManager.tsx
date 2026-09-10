'use client';

import { useEffect, useState } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * PHASE 2 — Waitlist manager (minimal). Shown inside the existing appointments
 * page — no new dashboard. All reads/writes go through the tenant-scoped,
 * RBAC-enforced API routes (server-side enforcement; this UI is never trusted).
 */
type WaitlistRow = {
  id: string;
  contact_name: string;
  contact_phone: string;
  preferred_date: string | null;
  preferred_window: string | null;
  status: string;
  created_at: string;
};

export default function WaitlistManager() {
  const { clinicId, authHeaders } = useClinicContext();
  const [entries, setEntries] = useState<WaitlistRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!clinicId) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/appointments/waitlist?clinic_id=${clinicId}`, { headers });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setEntries((body?.data ?? []) as WaitlistRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل قائمة الانتظار');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  async function cancelEntry(id: string) {
    if (!clinicId || !confirm('إلغاء هذا البند من قائمة الانتظار؟')) return;
    setBusy(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/appointments/waitlist', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ clinic_id: clinicId, entry_id: id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الإلغاء');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-lg font-semibold text-white">قائمة الانتظار</h3>
      <p className="mt-1 text-sm text-slate-400">المرضى بانتظار موعد شاغر (تُحدَّث عند الإلغاء).</p>

      {error && <p className="mt-3 rounded-lg border border-red-900 bg-red-950 p-2 text-sm text-red-300">{error}</p>}

      {entries.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">لا توجد بنود بقائمة الانتظار.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
              <div>
                <p className="font-semibold text-slate-100">{e.contact_name}</p>
                <p className="text-xs text-slate-400">
                  {e.contact_phone}
                  {e.preferred_date && ` — ${e.preferred_date}`}
                  {e.preferred_window && ` (${e.preferred_window})`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${e.status === 'notified' ? 'bg-teal-500/20 text-teal-300' : 'bg-slate-800 text-slate-300'}`}>
                  {e.status}
                </span>
                <button
                  type="button"
                  onClick={() => cancelEntry(e.id)}
                  disabled={busy}
                  className="rounded border border-rose-800 px-2 py-1 text-xs text-rose-300 disabled:opacity-50"
                >
                  إلغاء
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}