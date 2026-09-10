'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isSafeDashboardPath } from '@/lib/services/dashboardPaths';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function humanizeError(message: string): string {
    if (!message) return 'تعذر تسجيل الدخول. يرجى المحاولة مرة أخرى.';
    if (message.includes('Invalid login credentials')) {
      return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
    }
    if (message.includes('Email not confirmed')) {
      return 'لم يتم تأكيد البريد الإلكتروني بعد. يرجى التحقق من بريدك.';
    }
    if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('Network')) {
      return 'تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.';
    }
    if (message.includes('rate limit') || message.includes('Too many')) {
      return 'محاولات كثيرة. يرجى الانتظار قليلاً ثم إعادة المحاولة.';
    }
    return message;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(humanizeError(signInError.message));
        setIsSubmitting(false);
        return;
      }

      // `?next=` is honored only for safe internal dashboard paths (open-redirect guard).
      const requested = new URLSearchParams(window.location.search).get('next');
      router.replace(isSafeDashboardPath(requested) ? requested : '/dashboard');
    } catch (caught) {
      setError('تعذر الاتصال بخدمة المصادقة. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">تسجيل دخول العيادة</h1>
        <p className="mt-3 text-slate-400">استخدم البريد الإلكتروني وكلمة المرور لفتح لوحة تحكم موظفة الاستقبال الذكية.</p>

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
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-200">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="••••••••"
              required
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          <p>ليس لديك حساب؟</p>
          <Link href="/register" className="mt-1 inline-block font-medium text-cyan-300 hover:text-cyan-200">
            إنشاء حساب جديد
          </Link>
        </div>

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
            العودة إلى الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}