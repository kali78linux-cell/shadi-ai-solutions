'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function DashboardHeader() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    async function loadSession() {
      if (!isSupabaseConfigured) {
        setEmail('shadisuad78@gmail.com');
        return;
      }

      const { data } = await supabase.auth.getSession();
      setEmail(data?.session?.user.email ?? '');
    }

    loadSession();
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    } else {
      localStorage.removeItem('dentalai_demo_session');
    }
    router.replace('/login');
  }

  return (
    <div className="flex flex-col gap-4 rounded-[2rem] border border-slate-800 bg-slate-950/80 p-5 text-right sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-cyan-300/80">المستخدم</p>
        <p className="mt-2 text-sm text-slate-300">{email || 'مرحباً بك'}</p>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSigningOut ? 'جاري الخروج...' : 'تسجيل الخروج'}
      </button>
    </div>
  );
}
