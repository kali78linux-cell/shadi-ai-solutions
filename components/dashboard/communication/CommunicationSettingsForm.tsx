'use client';

import { useEffect, useState } from 'react';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import type { ClinicCommunicationSettings } from '@/lib/communications/settings';
import type { ChannelType } from '@/lib/communications/channels/types';

const CHANNELS: { value: ChannelType; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telegram', label: 'Telegram' },
];

const NOTIFICATION_TYPES: { key: 'reminderChannels' | 'confirmationChannels' | 'cancellationChannels'; label: string }[] = [
  { key: 'reminderChannels', label: 'Reminders' },
  { key: 'confirmationChannels', label: 'Confirmations' },
  { key: 'cancellationChannels', label: 'Cancellations' },
];

const DEFAULT_SETTINGS: ClinicCommunicationSettings = {
  clinicId: '',
  emailEnabled: true,
  smsEnabled: false,
  whatsappEnabled: false,
  telegramEnabled: false,
  reminderChannels: ['email'],
  confirmationChannels: ['email'],
  cancellationChannels: ['email'],
  defaultChannel: 'email',
  remindersEnabled: true,
  reminderOffsetMinutes1: 1440,
  reminderOffsetMinutes2: 120,
  confirmationNotifications: true,
  cancellationNotifications: true,
  reschedulingNotifications: true,
  notificationLanguage: 'ar',
};

export default function CommunicationSettingsForm() {
  const { isConfigured: isSupabaseConfigured } = useSupabaseConfig();
  const {
    clinicId,
    authHeaders,
    loading: clinicLoading,
    error: clinicError,
  } = useClinicContext();
  const [settings, setSettings] = useState<ClinicCommunicationSettings>(DEFAULT_SETTINGS);
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
    void loadSettings(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  async function loadSettings(id: string) {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/communication-settings?clinic_id=${encodeURIComponent(id)}`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load settings');
      setSettings(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  function toggleChannel(channel: ChannelType) {
    setSettings((prev) => {
      const key = channel === 'email' ? 'emailEnabled' : channel === 'sms' ? 'smsEnabled' : channel === 'whatsapp' ? 'whatsappEnabled' : 'telegramEnabled';
      return { ...prev, [key]: !prev[key] };
    });
  }

  function toggleNotificationChannel(typeKey: 'reminderChannels' | 'confirmationChannels' | 'cancellationChannels', channel: ChannelType) {
    setSettings((prev) => {
      const current = prev[typeKey];
      const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
      return { ...prev, [typeKey]: next };
    });
  }

  async function handleSave() {
    if (!clinicId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/communication-settings?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(settings),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save settings');
      setSettings(body.data);
      setSuccess('Settings saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-400">Loading communication settings...</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {success}
        </div>
      )}

      {/* Channel enablement */}
      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <p className="text-sm font-semibold text-white">Enabled Channels</p>
        <p className="mt-1 text-xs text-slate-400">Toggle which channels this clinic can use for notifications.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {CHANNELS.map((channel) => {
            const enabled = channel.value === 'email' ? settings.emailEnabled : channel.value === 'sms' ? settings.smsEnabled : channel.value === 'whatsapp' ? settings.whatsappEnabled : settings.telegramEnabled;
            return (
              <button
                key={channel.value}
                type="button"
                onClick={() => toggleChannel(channel.value)}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                  enabled ? 'border-cyan-500/70 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/60'
                }`}
              >
                <span className="text-sm font-semibold text-white">{channel.label}</span>
                <span className={`text-xs font-semibold ${enabled ? 'text-cyan-300' : 'text-slate-500'}`}>
                  {enabled ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notification-type channel routing */}
      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <p className="text-sm font-semibold text-white">Notification Channels</p>
        <p className="mt-1 text-xs text-slate-400">Choose which channels are used for each notification type.</p>
        <div className="mt-4 space-y-5">
          {NOTIFICATION_TYPES.map((type) => (
            <div key={type.key}>
              <p className="text-sm font-medium text-slate-300">{type.label}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {CHANNELS.map((channel) => {
                  const selected = settings[type.key].includes(channel.value);
                  return (
                    <button
                      key={channel.value}
                      type="button"
                      onClick={() => toggleNotificationChannel(type.key, channel.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        selected ? 'border-cyan-500/70 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 text-slate-400'
                      }`}
                    >
                      {channel.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Default channel */}
      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
        <p className="text-sm font-semibold text-white">Default Channel</p>
        <p className="mt-1 text-xs text-slate-400">Used when a notification type has no explicit channel routing.</p>
        <select
          value={settings.defaultChannel}
          onChange={(e) => setSettings((prev) => ({ ...prev, defaultChannel: e.target.value as ChannelType }))}
          className="mt-3 w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
        >
          {CHANNELS.map((channel) => (
            <option key={channel.value} value={channel.value}>
              {channel.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}