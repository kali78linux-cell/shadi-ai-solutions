'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

/**
 * PHASE K — "نسيت كلمة السر؟" — sends the Supabase password recovery email.
 * The recovery link redirects back to /reset-password.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (resetError) {
        setError('تعذر إرسال رسالة الاستعادة. تحقق من بريدك ثم أعد المحاولة.');
        return;
      }
      setSent(true);
    } catch {
      setError('تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">استعادة كلمة المرور</h1>

        {sent ? (
          <div className="mt-6 space-y-4 text-sm">
            <p className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">
              إذا كان البريد مسجلًا لدينا فستصلك رسالة تحتوي رابط إعادة التعيين خلال دقائق.
            </p>
            <p className="text-slate-400">لم تصلك الرسالة؟ تفقد مجلد الرسائل غير المرغوبة ثم أعد المحاولة.</p>
            <Link href="/login" className="btn-secondary w-full">
              العودة إلى تسجيل الدخول
            </Link>
          </div>
        ) : (
          <>
            <p className="mt-3 text-slate-400">
              أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور.
            </p>
            <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-200">
                  البريد الإلكتروني
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
                  placeholder="clinic@example.com"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'جارٍ الإرسال...' : 'إرسال رابط الاستعادة'}
              </button>
            </form>

            <div className="mt-6 text-center text-sm">
              <Link href="/login" className="font-medium text-cyan-300 hover:text-cyan-200">
                العودة إلى تسجيل الدخول
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
