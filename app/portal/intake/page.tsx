'use client';

import { useEffect, useState } from 'react';

/**
 * PHASE 4 — Digital Intake (portal). Lists ACTIVE forms, renders schema-driven
 * fields, submits server-validated responses (UI never trusted).
 */
type IntakeField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multi_select';
  required?: boolean;
  options?: string[];
  max_length?: number;
};

type IntakeForm = {
  id: string;
  title: string;
  description: string | null;
  form_schema: IntakeField[];
  consent_text: string | null;
};

const inputCls = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100';

export default function PortalIntakePage() {
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [activeForm, setActiveForm] = useState<IntakeForm | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/intake/forms', { credentials: 'include' });
      if (!res.ok) {
        setState('denied');
        return;
      }
      const body = await res.json();
      setForms(body.data ?? []);
      setState('ready');
    })();
  }, []);

  async function submit() {
    if (!activeForm) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/intake/submit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          form_id: activeForm.id,
          answers,
          consent: activeForm.consent_text ? consent : undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.error === 'INTAKE_VALIDATION_FAILED' && Array.isArray(body.details)) {
          throw new Error(body.details.map((d: any) => `${d.key}: ${d.message}`).join(' · '));
        }
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setDone(activeForm.title);
      setActiveForm(null);
      setAnswers({});
      setConsent(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الإرسال');
    } finally {
      setBusy(false);
    }
  }

  function renderField(f: IntakeField) {
    const value = answers[f.key];
    switch (f.type) {
      case 'boolean':
        return <input type="checkbox" checked={Boolean(value)} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.checked })} className="h-4 w-4" />;
      case 'select':
        return (
          <select value={String(value ?? '')} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} className={inputCls}>
            <option value="">— اختر —</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      case 'multi_select':
        return (
          <div className="flex flex-wrap gap-2">
            {(f.options ?? []).map((o) => {
              const arr = Array.isArray(value) ? value.map(String) : [];
              return (
                <label key={o} className="flex items-center gap-1 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={arr.includes(o)}
                    onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.checked ? [...arr, o] : arr.filter((x) => x !== o) })}
                  />
                  {o}
                </label>
              );
            })}
          </div>
        );
      case 'date':
        return <input type="date" value={String(value ?? '')} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} className={inputCls} />;
      case 'number':
        return (
          <input
            type="number"
            value={value === undefined ? '' : String(value)}
            onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
            className={inputCls}
          />
        );
      default:
        return (
          <input type="text" value={String(value ?? '')} maxLength={f.max_length ?? 500} onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })} className={inputCls} />
        );
    }
  }

  if (state === 'loading') return <p className="p-6 text-slate-400">جارٍ التحميل…</p>;
  if (state === 'denied') return <p className="p-6 text-red-400">غير مصرح — سجل الدخول إلى البوابة.</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-bold text-white">الاستمارات الرقمية</h1>
      {done && <p className="rounded-lg border border-teal-800 bg-teal-950 p-3 text-sm text-teal-300">تم إرسال «{done}» بنجاح.</p>}
      {error && <p className="rounded-lg border border-red-900 bg-red-950 p-3 text-sm text-red-300">{error}</p>}

      {!activeForm && forms.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">لا توجد استمارات متاحة حاليًا.</p>
      )}

      {!activeForm && forms.length > 0 && (
        <ul className="space-y-2">
          {forms.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/70 p-4">
              <div>
                <p className="font-semibold text-slate-100">{f.title}</p>
                {f.description && <p className="text-xs text-slate-400">{f.description}</p>}
              </div>
              <button type="button" onClick={() => { setActiveForm(f); setError(null); }} className="rounded-lg bg-teal-500 px-3 py-1.5 text-sm font-semibold text-stone-900">
                تعبئة
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeForm && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="text-lg font-semibold text-white">{activeForm.title}</h2>
          {activeForm.description && <p className="mt-1 text-sm text-slate-400">{activeForm.description}</p>}
          <div className="mt-4 space-y-4">
            {activeForm.form_schema.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-sm text-slate-300">
                  {f.label}
                  {f.required && <span className="text-red-400"> *</span>}
                </label>
                {renderField(f)}
              </div>
            ))}
          </div>

          {activeForm.consent_text && (
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 p-3">
              <p className="text-xs leading-relaxed text-slate-400">{activeForm.consent_text}</p>
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                أوافق على ما سبق (مطلوب)
              </label>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button type="button" onClick={submit} disabled={busy} className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-stone-900 disabled:opacity-50">
              {busy ? '…' : 'إرسال'}
            </button>
            <button type="button" onClick={() => { setActiveForm(null); setError(null); }} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">
              رجوع
            </button>
          </div>
        </div>
      )}
    </div>
  );
}