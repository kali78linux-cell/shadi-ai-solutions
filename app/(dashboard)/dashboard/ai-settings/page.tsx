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
  appointment_booking_enabled?: boolean | null;
  knowledge_retrieval_enabled?: boolean | null;
  confidence_threshold?: number | null;
  safety_controls?: Record<string, unknown> | null;
};

export default function AISettingsPage() {
  const { isConfigured: isSupabaseConfigured } = useSupabaseConfig();
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
      if (!res.ok) throw new Error('AI settings unavailable');
      const payload = await res.json();
      const data = payload?.data ?? {};
      setSettings({
        assistant_name: data.assistant_name ?? 'Dental AI Receptionist',
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
      setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
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
      if (!res.ok) throw new Error('Unable to save AI settings');
      const payload = await res.json();
      setSettings((current) => ({ ...current, ...(payload?.data ?? {}) }));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save AI settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardSection title="AI Settings" subtitle="Control the assistant behavior, tone, greeting, languages, and business rules.">
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : !isSupabaseConfigured ? (
        <EmptyState title="Supabase is not configured" description="Enable your clinic backend to load and persist AI settings." />
      ) : error ? (
        <EmptyState title="AI settings unavailable" description={error} />
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">Assistant name</label>
              <input
                value={settings.assistant_name ?? ''}
                onChange={(e) => setSettings((current) => ({ ...current, assistant_name: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              />
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">Tone / personality</label>
              <select
                value={settings.tone ?? 'friendly'}
                onChange={(e) => setSettings((current) => ({ ...current, tone: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="warm">Warm</option>
                <option value="concise">Concise</option>
              </select>
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">Language</label>
              <select
                value={settings.language ?? 'ar'}
                onChange={(e) => setSettings((current) => ({ ...current, language: e.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
              >
                <option value="ar">Arabic</option>
                <option value="en">English</option>
                <option value="both">Arabic + English</option>
              </select>
            </div>
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label className="block text-sm text-slate-400">Confidence threshold</label>
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
            <label className="block text-sm text-slate-400">Greeting</label>
            <textarea
              value={settings.greeting ?? ''}
              onChange={(e) => setSettings((current) => ({ ...current, greeting: e.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>Lead detection</span>
              <input
                type="checkbox"
                checked={settings.lead_detection_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, lead_detection_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>Appointment booking</span>
              <input
                type="checkbox"
                checked={settings.appointment_booking_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, appointment_booking_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
            <label className="flex items-center justify-between rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 text-sm text-slate-300">
              <span>Knowledge retrieval</span>
              <input
                type="checkbox"
                checked={settings.knowledge_retrieval_enabled ?? true}
                onChange={(e) => setSettings((current) => ({ ...current, knowledge_retrieval_enabled: e.target.checked }))}
                className="h-5 w-5 accent-cyan-500"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button type="submit" disabled={saving} className="rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save AI settings'}
            </button>
            {saved ? <span className="text-sm text-emerald-400">Saved successfully.</span> : null}
            {error ? <span className="text-sm text-red-400">{error}</span> : null}
          </div>
        </form>
      )}
    </DashboardSection>
  );
}