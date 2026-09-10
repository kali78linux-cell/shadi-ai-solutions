import type { ReactNode } from 'react';
import DashboardAuthGuard from '@/components/auth/DashboardAuthGuard';
import DashboardHeader from '@/components/auth/DashboardHeader';
import DashboardSidebar from '@/components/dashboard/DashboardSidebar';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * TENANT-ISOLATED DASHBOARD — Arabic shell for every dashboard route.
 * The old hard-coded English chrome ("Dental AI Receptionist", Home/Patients/
 * Appointments pills, English sidebar) is retired: the sidebar is the grouped,
 * activity-aware Arabic DashboardSidebar and every module lives on the
 * canonical `/dashboard/{clinicSlug}/{module}` route.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardAuthGuard>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {!isSupabaseConfigured && (
            <div className="mb-4 rounded-[2rem] border border-amber-500/30 bg-amber-500/10 p-4 text-right text-sm text-amber-100 shadow-lg shadow-amber-900/20">
              <p className="font-semibold text-amber-200">التطبيق يعمل في وضع العرض التجريبي المحلي.</p>
              <p className="mt-1 text-slate-200">
                لتشغيل الإصدار الحقيقي، أضف مفاتيح Supabase في <span className="font-semibold">.env.local</span> ثم أعد تشغيل التطبيق.
              </p>
            </div>
          )}
          <DashboardHeader />

          <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="h-fit rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-lg shadow-slate-950/20">
              <DashboardSidebar />
            </aside>
            <section className="space-y-6">{children}</section>
          </div>
        </div>
      </div>
    </DashboardAuthGuard>
  );
}
