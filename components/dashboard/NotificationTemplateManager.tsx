'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';

type Template = { id: string; name: string; subject: string | null; body: string | null; active: boolean };

export default function NotificationTemplateManager() {
  const { isConfigured: isSupabaseConfigured } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', subject: '', body: '' });

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

  async function load() {
    if (!clinicId) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/notification-templates?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      if (!res.ok) throw new Error('Failed to load');
      const body = await res.json();
      setTemplates(body.data || []);
    } catch (e) {
      // ignore
    } finally { setLoading(false); }
  }

  function openCreate() { setEditingId(null); setForm({ name: '', subject: '', body: '' }); setFormOpen(true); }
  function openEdit(t: Template) { setEditingId(t.id); setForm({ name: t.name || '', subject: t.subject || '', body: t.body || '' }); setFormOpen(true); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicId) return;
    const headers = await authHeaders();
    const url = editingId ? `/api/clinic/notification-templates/${editingId}?clinic_id=${encodeURIComponent(clinicId)}` : `/api/clinic/notification-templates?clinic_id=${encodeURIComponent(clinicId)}`;
    const method = editingId ? 'PUT' : 'POST';
    await fetch(url, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(form) });
    setFormOpen(false); load();
  }

  async function remove(id: string) {
    if (!clinicId || !confirm('Delete this template?')) return;
    const headers = await authHeaders();
    await fetch(`/api/clinic/notification-templates/${id}?clinic_id=${encodeURIComponent(clinicId)}`, { method: 'DELETE', headers });
    load();
  }

  if (loading) return <Skeleton className="h-60" />;
  if (!isSupabaseConfigured) return <EmptyState title="Supabase is not configured" description="Enable your clinic backend to manage templates." />;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" onClick={openCreate} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Add Template</button>
      </div>

      {formOpen ? (
        <form onSubmit={submit} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <div className="grid gap-4">
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name" required className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="Subject (use {{name}})" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Body (use {{name}}, {{appointment.time}})" rows={6} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Save</button>
            <button type="button" onClick={() => setFormOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
          </div>
        </form>
      ) : null}

      {templates.length === 0 ? (
        <EmptyState title="No templates" description="Create notification templates to send confirmations and reminders." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">{t.name}</p>
                  <p className="mt-1 text-sm text-slate-400">{t.subject}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${t.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{t.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="mt-3 flex justify-end gap-3 text-sm">
                <button type="button" onClick={() => openEdit(t)} className="text-cyan-400">Edit</button>
                <button type="button" onClick={() => remove(t.id)} className="text-red-400">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}