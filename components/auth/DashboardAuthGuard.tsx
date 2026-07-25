'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export default function DashboardAuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkSession() {
      if (!isSupabaseConfigured) {
        const demoSession = localStorage.getItem('dentalai_demo_session');
        if (!demoSession) {
          if (isMounted) setIsChecking(false);
          router.replace('/login');
          return;
        }
        if (isMounted) setIsChecking(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (!data?.session) {
        setIsChecking(false);
        router.replace('/login');
        return;
      }

      setIsChecking(false);
    }

    checkSession();

    if (isSupabaseConfigured) {
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          router.replace('/login');
        }
      });

      return () => {
        isMounted = false;
        listener.subscription.unsubscribe();
      };
    }

    return () => {
      isMounted = false;
    };
  }, [router]);

  if (isChecking) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 px-4 py-12 text-center">
        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/90 px-8 py-10 shadow-xl shadow-slate-950/30">
          <p className="text-lg font-semibold text-white">جارٍ التحقق من تسجيل الدخول...</p>
          <p className="mt-3 text-sm leading-6 text-slate-400">إذا لم تكن مسجلاً، فسوف تعود إلى صفحة الدخول تلقائياً.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
