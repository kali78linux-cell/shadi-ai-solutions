'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const DEMO_USER = {
  email: 'shadisuad78@gmail.com',
  password: '111978',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    if (!isSupabaseConfigured) {
      if (email === DEMO_USER.email && password === DEMO_USER.password) {
        localStorage.setItem('dentalai_demo_session', 'true');
        router.replace('/dashboard');
      } else {
        setError('البريد الإلكتروني أو كلمة المرور غير صحيحة. استخدم معلومات العرض التجريبي.');
      }
      setIsSubmitting(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace('/dashboard');
  }

  function handleDemoLogin() {
    setEmail(DEMO_USER.email);
    setPassword(DEMO_USER.password);
    localStorage.setItem('dentalai_demo_session', 'true');
    router.replace('/dashboard');
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">تسجيل دخول العيادة</h1>
        <p className="mt-3 text-slate-400">استخدم البريد الإلكتروني وكلمة المرور لفتح لوحة تحكم Dental AI Receptionist.</p>

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
          <p>إذا لم يكن لديك حساب، اضبط مستخدم Supabase في لوحة التحكم لتجربة الحماية.</p>
        </div>

        <div className="mt-6 text-center text-sm text-slate-500">
          <p>إذا لم يكن لديك حساب، يمكنك استخدام تسجيل الدخول التجريبي المحلي أو ضبط Supabase.</p>
        </div>

        {!isSupabaseConfigured && (
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleDemoLogin}
              className="w-full rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
            >
              تسجيل دخول تجريبي
            </button>
            <p className="text-xs text-slate-500">
              بريد العرض: {DEMO_USER.email} · كلمة المرور: {DEMO_USER.password}
            </p>
          </div>
        )}

        <div className="mt-8 text-center">
          <Link href="/" className="text-sm font-medium text-cyan-300 hover:text-cyan-200">
            العودة إلى الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}
