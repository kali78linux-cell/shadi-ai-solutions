'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';

type Provider = { id: string; name: string; title: string | null; provider_type: string; active: boolean };
type Service = { id: string; name: string; description: string | null; duration_minutes: number; price: number | null; active: boolean };

type Mode = 'providers' | 'services';

export default function ProviderServiceManager({ mode }: { mode: Mode }) {
  const { isConfigured: isSupabaseConfigured } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const [items, setItems] = useState<Provider[] | Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const endpoint = mode === 'providers' ? '/api/clinic/providers' : '/api/clinic/services';

  async function load() {
    if (!clinicId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      if (!res.ok) throw new Error('Failed to load');
      const body = await res.json();
      setItems(body.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    if (clinicLoading) { setLoading(true); return; }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  function openCreate() {
    setEditingId(null);
    setForm(mode === 'providers' ? { name: '', title: '', provider_type: 'dentist' } : { name: '', description: '', duration_minutes: '30', price: '' });
    setIsFormOpen(true);
  }

  function openEdit(item: Provider | Service) {
    setEditingId(item.id);
    if (mode === 'providers') {
      const p = item as Provider;
      setForm({ name: p.name, title: p.title ?? '', provider_type: p.provider_type });
    } else {
      const s = item as Service;
      setForm({ name: s.name, description: s.description ?? '', duration_minutes: String(s.duration_minutes), price: s.price != null ? String(s.price) : '' });
    }
    setIsFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) return;
    setSubmitting(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const url = editingId ? `${endpoint}/${editingId}?clinic_id=${encodeURIComponent(clinicId)}` : `${endpoint}?clinic_id=${encodeURIComponent(clinicId)}`;
      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to save');
      setIsFormOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(item: Provider | Service) {
    if (!clinicId) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}/${item.id}?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ active: !item.active }),
      });
      if (!res.ok) throw new Error('Failed to toggle');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle');
    }
  }

  async function handleDelete(id: string) {
    if (!clinicId || !confirm('Delete this item?')) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${endpoint}/${id}?clinic_id=${encodeURIComponent(clinicId)}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Failed to delete');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  }

  if (loading) return <Skeleton className="h-60" />;
  if (!isSupabaseConfigured) return <EmptyState title="Supabase is not configured" description="Enable your clinic backend to manage providers and services." />;
  if (error) return <EmptyState title="Service unavailable" description={error} />;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" onClick={openCreate} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Add {mode === 'providers' ? 'Provider' : 'Service'}</button>
      </div>

      {isFormOpen ? (
        <form onSubmit={handleSubmit} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <input value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" required className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            {mode === 'providers' ? (
              <>
                <input value={form.title || ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title (e.g. Dentist)" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
                <select value={form.provider_type || 'dentist'} onChange={(e) => setForm((f) => ({ ...f, provider_type: e.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100">
                  <option value="dentist">Dentist</option>
                  <option value="hygienist">Hygienist</option>
                  <option value="staff">Staff</option>
                </select>
              </>
            ) : (
              <>
                <input value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Description" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
                <input type="number" value={form.duration_minutes || ''} onChange={(e) => setForm((f) => ({ ...f, duration_minutes: e.target.value }))} placeholder="Duration (minutes)" required className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
                <input type="number" value={form.price || ''} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="Price" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
              </>
            )}
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={submitting} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{submitting ? 'Saving...' : 'Save'}</button>
            <button type="button" onClick={() => setIsFormOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
          </div>
          {error && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        </form>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title={`No ${mode} yet`} description={`Add your first ${mode === 'providers' ? 'dentist' : 'service'} to make it available for public booking.`} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {(items as any[]).map((item) => (
            <div key={item.id} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{item.name}</p>
                  {mode === 'providers' ? (
                    <p className="mt-1 text-sm text-slate-400">{item.title || item.provider_type}</p>
                  ) : (
                    <p className="mt-1 text-sm text-slate-400">{item.duration_minutes} min{item.price != null ? ` • ${item.price}` : ''}</p>
                  )}
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{item.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mt-3 flex justify-end gap-3 text-sm">
                <button type="button" onClick={() => openEdit(item)} className="text-cyan-400">Edit</button>
                <button type="button" onClick={() => handleToggle(item)} className="text-amber-400">{item.active ? 'Disable' : 'Enable'}</button>
                <button type="button" onClick={() => handleDelete(item.id)} className="text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}