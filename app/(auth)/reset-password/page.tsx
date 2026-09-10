'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

/**
 * PHASE K — password reset landing (target of the Supabase recovery email).
 * The recovery link establishes a session in this browser; we then swap the
 * password via updateUser and sign out for a clean re-login.
 */
export default function ResetPasswordPage() {
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSessionReady(Boolean(data.session)));
  }, []);

  function humanizeError(message: string): string {
    if (message.toLowerCase().includes('at least 6')) return 'كلمة المرور قصيرة جدًا (6 أحرف على الأقل).';
    if (message.includes('different from the old password')) return 'اختر كلمة مرور مختلفة عن السابقة.';
    return message;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      return;
    }
    if (password !== confirm) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(humanizeError(updateError.message));
        return;
      }
      await supabase.auth.signOut();
      setDone(true);
    } catch {
      setError('تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">تعيين كلمة مرور جديدة</h1>

        {sessionReady === null ? (
          <p className="mt-6 text-sm text-slate-400">جارٍ التحقق من الرابط...</p>
        ) : done ? (
          <div className="mt-6 space-y-4 text-sm">
            <p className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">
              تم تحديث كلمة المرور بنجاح ✓ سجّل الدخول بكلمة المرور الجديدة.
            </p>
            <Link href="/login" className="btn-primary w-full">
              تسجيل الدخول
            </Link>
          </div>
        ) : !sessionReady ? (
          <div className="mt-6 space-y-4 text-sm">
            <p className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
              الرابط منتهي الصلاحية أو فُتح من متصفح مختلف. اطلب رابط استعادة جديدًا.
            </p>
            <Link href="/forgot-password" className="btn-secondary w-full">
              إرسال رابط جديد
            </Link>
          </div>
        ) : (
          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-200">
                كلمة المرور الجديدة
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                placeholder="••••••••"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-slate-200">
                تأكيد كلمة المرور
              </label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
