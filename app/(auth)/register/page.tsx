'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export default function RegisterPage() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState('');
  const [clinicSlug, setClinicSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  function humanizeError(message: string): string {
    if (!message) return 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.';
    if (message.includes('already registered')) {
      return 'هذا البريد الإلكتروني مسجل بالفعل. يرجى تسجيل الدخول.';
    }
    if (message.includes('already taken')) {
      return 'عنوان URL هذا مستخدم بالفعل. يرجى اختيار عنوان آخر.';
    }
    if (message.includes('Password should be at least')) {
      return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.';
    }
    if (message.includes('fetch') || message.includes('Failed to fetch') || message.includes('Network')) {
      return 'تعذر الاتصال بخدمة التسجيل. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.';
    }
    return message;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      setIsSubmitting(false);
      return;
    }

    const slug = normalizeSlug(clinicSlug || clinicName);
    if (!slug) {
      setError('يرجى إدخال اسم عيادة صالح لإنشاء عنوان URL.');
      setIsSubmitting(false);
      return;
    }

    try {
      // Server-side registration creates the confirmed auth user, clinic,
      // and clinic_users owner membership atomically (with rollback).
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          clinic_name: clinicName,
          clinic_slug: slug,
        }),
      });

      const result = await response.json();
      setIsSubmitting(false);

      if (!response.ok) {
        setError(humanizeError(result.error || 'حدث خطأ أثناء إنشاء العيادة.'));
        return;
      }

      setMessage('تم إنشاء العيادة والمستخدم بنجاح. سيتم تحويلك إلى صفحة تسجيل الدخول...');

      // Server created a confirmed auth user; redirect to login so the user
      // signs in with a fresh, real session.
      setTimeout(() => {
        router.replace('/login?registered=1');
      }, 1200);
    } catch (caught) {
      setError('تعذر الاتصال بخدمة التسجيل. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.');
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">إنشاء حساب عيادة جديدة</h1>
        <p className="mt-3 text-slate-400">سجل كمالك العيادة لبدء استخدام لوحة تحكم Dental AI Receptionist.</p>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="clinicName" className="block text-sm font-medium text-slate-200">
              اسم العيادة
            </label>
            <input
              id="clinicName"
              value={clinicName}
              onChange={(event) => setClinicName(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="عيادة الأسنان المتميزة"
              required
            />
          </div>

          <div>
            <label htmlFor="clinicSlug" className="block text-sm font-medium text-slate-200">
              عنوان URL قصير للعيادة (اختياري)
            </label>
            <input
              id="clinicSlug"
              value={clinicSlug}
              onChange={(event) => setClinicSlug(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="clinic-name"
            />
          </div>

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
              minLength={6}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-200">
              تأكيد كلمة المرور
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-400">{message}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'جارٍ الإنشاء...' : 'إنشاء حساب العيادة'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-slate-500">
          <p>لديك حساب بالفعل؟</p>
          <Link href="/login" className="text-cyan-300 hover:text-cyan-200">
            تسجيل دخول
          </Link>
        </div>
      </div>
    </main>
  );
}