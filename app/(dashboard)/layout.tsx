import Link from 'next/link';
import type { ReactNode } from 'react';
import DashboardAuthGuard from '@/components/auth/DashboardAuthGuard';
import DashboardHeader from '@/components/auth/DashboardHeader';
import ClinicSwitcher from '@/components/dashboard/ClinicSwitcher';
import { isSupabaseConfigured } from '@/lib/supabase';

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

          <div className="mb-8 flex flex-col gap-4 rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-cyan-300/80">لوحة تحكم العيادة</p>
              <h1 className="mt-2 text-2xl font-semibold text-white">Dental AI Receptionist</h1>
              <p className="mt-1 text-sm text-slate-400">إدارة المواعيد، دردشة AI، وقاعدة المعرفة في مكان واحد.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ClinicSwitcher />
              <Link href="/dashboard/overview" className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-500/70">
                Home
              </Link>
              <Link href="/dashboard/patients" className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-500/70">
                Patients
              </Link>
              <Link href="/dashboard/appointments" className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-500/70">
                Appointments
              </Link>
              <Link href="/dashboard/conversations" className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-500/70">
                AI Conversations
              </Link>
              <Link href="/dashboard/knowledge-base" className="rounded-full border border-slate-700 bg-slate-950/80 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-500/70">
                Knowledge Base
              </Link>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-[2rem] border border-slate-800 bg-slate-900/90 p-6 shadow-lg shadow-slate-950/20">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/80">القائمة</p>
              <nav className="mt-6 space-y-3 text-sm text-slate-300">
                <Link href="/dashboard/overview" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Dashboard Home
                </Link>
                <Link href="/dashboard/clinic-setup" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Clinic Setup
                </Link>
                <Link href="/dashboard/patients" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Patients
                </Link>
                <Link href="/dashboard/appointments" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Appointments
                </Link>
                <Link href="/dashboard/conversations" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  AI Conversations
                </Link>
                <Link href="/dashboard/knowledge-base" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Knowledge Base
                </Link>
                <Link href="/dashboard/ai-settings" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  AI Settings
                </Link>
                <Link href="/dashboard/team" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Team Management
                </Link>
                <Link href="/dashboard/analytics" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Analytics
                </Link>
                <Link href="/dashboard/subscription" className="block rounded-2xl border border-slate-800 bg-slate-950/80 px-4 py-3 transition hover:border-cyan-500/70 hover:text-white">
                  Subscription
                </Link>
              </nav>
            </aside>
            <section className="space-y-6">{children}</section>
          </div>
        </div>
      </div>
    </DashboardAuthGuard>
  );
}
