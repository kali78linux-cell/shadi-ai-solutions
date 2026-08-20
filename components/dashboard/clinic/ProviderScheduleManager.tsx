'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type ScheduleRow = { weekday: number; enabled: boolean; start_time: string; end_time: string; appointment_duration_minutes?: number; max_appointments_per_day?: number | null };
type Provider = { id: string; name: string; title: string | null };
type Service = { id: string; name: string };

export default function ProviderScheduleManager() {
  const { isConfigured: isSupabaseConfigured } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    if (clinicLoading) { setLoading(true); return; }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    let mounted = true;
    async function resolve() {
      try {
        const headers = await authHeaders();
        const [pRes, sRes] = await Promise.all([
          fetch(`/api/clinic/providers?clinic_id=${encodeURIComponent(clinicId)}`, { headers }),
          fetch(`/api/clinic/services?clinic_id=${encodeURIComponent(clinicId)}`, { headers }),
        ]);
        const pBody = await pRes.json();
        const sBody = await sRes.json();
        if (mounted) {
          setProviders(pBody.data || []);
          setServices(sBody.data || []);
          if (pBody.data?.[0]) setSelectedProvider(pBody.data[0].id);
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void resolve();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  useEffect(() => {
    if (!clinicId || !selectedProvider) return;
    let mounted = true;
    async function load() {
      setError(null);
      try {
        const headers = await authHeaders();
        const [schedRes, assignRes] = await Promise.all([
          fetch(`/api/clinic/providers/${selectedProvider}/schedule?clinic_id=${encodeURIComponent(clinicId)}`, { headers }),
          fetch(`/api/clinic/providers/${selectedProvider}/services?clinic_id=${encodeURIComponent(clinicId)}`, { headers }),
        ]);
        const schedBody = await schedRes.json();
        const assignBody = await assignRes.json();
        if (!mounted) return;
        const rows = schedBody.data || [];
        // Ensure all 7 days present and include duration/max fields
        const full: ScheduleRow[] = DAYS.map((_, i) => {
          const existing = rows.find((r: any) => r.weekday === i);
          return existing
            ? {
                weekday: i,
                enabled: existing.enabled,
                start_time: existing.start_time,
                end_time: existing.end_time,
                appointment_duration_minutes: existing.appointment_duration_minutes ?? 30,
                max_appointments_per_day: existing.max_appointments_per_day ?? null,
              }
            : { weekday: i, enabled: false, start_time: '09:00', end_time: '17:00', appointment_duration_minutes: 30, max_appointments_per_day: null };
        });
        setSchedule(full);
        setAssigned(assignBody.data || []);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load schedule');
      }
    }
    void load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, selectedProvider]);

  function updateRow(weekday: number, patch: Partial<ScheduleRow>) {
    setSchedule((cur) => cur.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  function toggleService(id: string) {
    setAssigned((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]));
  }

  async function saveSchedule() {
    if (!clinicId || !selectedProvider) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      for (const row of schedule) {
        if (row.enabled) {
          if (row.end_time <= row.start_time) throw new Error(`end_time must be after start_time on weekday ${row.weekday}`);
          const dur = row.appointment_duration_minutes ?? 30;
          if (dur < 5 || dur > 480) throw new Error(`appointment_duration_minutes must be between 5 and 480 on weekday ${row.weekday}`);
        }
      }
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/providers/${selectedProvider}/schedule?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ schedule }),
      });
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || 'Failed to save schedule'); }
      setSuccess('Schedule saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save schedule'); }
    finally { setSaving(false); }
  }

  async function saveAssignments() {
    if (!clinicId || !selectedProvider) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/providers/${selectedProvider}/services?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ service_ids: assigned }),
      });
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || 'Failed to save assignments'); }
      setSuccess('Services saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to save assignments'); }
    finally { setSaving(false); }
  }

  if (loading) return <Skeleton className="h-60" />;
  if (!isSupabaseConfigured) return <EmptyState title="Supabase is not configured" description="Enable your clinic backend to manage provider schedules." />;
  if (error && providers.length === 0) return <EmptyState title="Service unavailable" description={error} />;

  return (
    <div className="space-y-6">
      {error && <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
      {success && <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div>}

      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <label className="text-sm text-slate-400">Select Provider</label>
        <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100">
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ''}</option>)}
        </select>
      </div>

      {selectedProvider && (
        <>
          <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm font-semibold text-white">Working Hours</p>
            <div className="mt-4 space-y-3">
              {schedule.map((row) => (
                <div key={row.weekday} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
                  <label className="flex w-28 items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={row.enabled} onChange={(e) => updateRow(row.weekday, { enabled: e.target.checked })} className="h-4 w-4" />
                    {DAYS[row.weekday]}
                  </label>
                  <input type="time" value={row.start_time} disabled={!row.enabled} onChange={(e) => updateRow(row.weekday, { start_time: e.target.value })} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-40" />
                  <span className="text-slate-500">to</span>
                  <input type="time" value={row.end_time} disabled={!row.enabled} onChange={(e) => updateRow(row.weekday, { end_time: e.target.value })} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-40" />
                  <div className="ml-auto flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400">Dur (min)</label>
                      <input type="number" min={5} max={480} value={row.appointment_duration_minutes ?? 30} disabled={!row.enabled} onChange={(e) => updateRow(row.weekday, { appointment_duration_minutes: Number(e.target.value) })} className="w-20 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-40" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-400">Max/day</label>
                      <input type="number" min={1} max={500} value={row.max_appointments_per_day ?? ''} disabled={!row.enabled} onChange={(e) => updateRow(row.weekday, { max_appointments_per_day: e.target.value === '' ? null : Number(e.target.value) })} className="w-24 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-40" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={saveSchedule} disabled={saving} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{saving ? 'Saving...' : 'Save Schedule'}</button>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm font-semibold text-white">Services</p>
            <p className="mt-1 text-xs text-slate-400">Select which services this provider can perform.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {services.map((s) => (
                <button key={s.id} type="button" onClick={() => toggleService(s.id)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${assigned.includes(s.id) ? 'border-cyan-500/70 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 text-slate-400'}`}>
                  {s.name}
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={saveAssignments} disabled={saving} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{saving ? 'Saving...' : 'Save Services'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}