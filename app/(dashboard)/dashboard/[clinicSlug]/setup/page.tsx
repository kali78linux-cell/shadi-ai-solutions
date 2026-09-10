'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';

/**
 * Clinic Setup Wizard — a progressive, non-blocking guide over the EXISTING
 * setup pages (clinic profile, team, services, providers, hours, AI, KB).
 * Each step links to its real page; completion state comes from the
 * authorized /api/clinic/setup-status endpoint (never guessed client-side).
 * The owner can complete steps in any order and come back later.
 */

type SetupStatus = {
  checks?: {
    profile?: boolean;
    providers?: boolean;
    services?: boolean;
    schedule?: boolean;
    assignment?: boolean;
  };
};

// Steps backed by /api/clinic/setup-status "checks" have tracked: set.
const STEPS = [
  { key: 'profile', label: 'بيانات العيادة', desc: 'الاسم والهاتف والعنوان', href: '/dashboard/clinic-setup', tracked: true },
  { key: 'providers', label: 'الأطباء والموظفون', desc: 'أضف طبيباً واحداً على الأقل', href: '/dashboard/team', tracked: true },
  { key: 'services', label: 'الخدمات والأسعار', desc: 'عرّف خدمات عيادتك ومدتها', href: '/dashboard/services', tracked: true },
  { key: 'assignment', label: 'ربط الأطباء بالخدمات', desc: 'من يقدّم أي خدمة', href: '/dashboard/providers', tracked: true },
  { key: 'schedule', label: 'ساعات العمل', desc: 'جدول العمل والاستراحات', href: '/dashboard/providers', tracked: true },
  { key: null, label: 'إعداد الذكاء الاصطناعي', desc: 'فعّل الاستقبال الآلي', href: '/dashboard/ai-settings', tracked: false },
  { key: null, label: 'قاعدة المعرفة', desc: 'ارفع معلومات عيادتك للـAI', href: '/dashboard/knowledge-base', tracked: false },
] as const;

export default function SetupWizardPage() {
  const { clinicId, authHeaders, loading, error: clinicError } = useClinicContext();
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    if (loading || !clinicId) return;
    (async () => {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/setup-status?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
      if (res.ok) {
        const body = await res.json();
        setStatus(body?.data ?? body ?? {});
      }
    })();
  }, [loading, clinicId, authHeaders]);

  if (loading) return <Skeleton className="h-60" />;
  if (clinicError) return <EmptyState title="تعذر تحميل الإعداد" description={clinicError} />;
  if (!clinicId) return <EmptyState title="لا توجد عيادة" description="سجّل الدخول لبدء إعداد عيادتك." />;

  const done = STEPS.filter((s) => s.tracked && status?.checks?.[s.key]).length;

  return (
    <DashboardSection
      title="إعداد العيادة"
      subtitle={`أكمل الخطوات بالترتيب الذي يناسبك — يمكنك العودة في أي وقت. أكملت ${done} من ${STEPS.filter((s) => s.tracked).length} خطوة أساسية (${STEPS.length} إجمالًا، والمتبقي اختياري).`}
    >
      <ol className="space-y-3">
        {STEPS.map((step, i) => {
          const complete = step.tracked ? Boolean(status?.checks?.[step.key]) : false;
          return (
            <li key={step.key ?? step.label}>
              <Link
                href={step.href}
                className={`flex items-center gap-4 rounded-2xl border p-4 transition hover:border-cyan-500/60 ${
                  complete ? 'border-emerald-700/40 bg-emerald-900/10' : 'border-slate-800 bg-slate-950/70'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    complete ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {complete ? '✓' : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-white">{step.label}</span>
                  <span className="block text-sm text-slate-400">{step.desc}</span>
                </span>
                {!step.tracked && (
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">اختياري</span>
                )}
                <span className="text-cyan-300">←</span>
              </Link>
            </li>
          );
        })}
        <li>
          <div
            className={`flex items-center gap-4 rounded-2xl border p-4 ${
              done === STEPS.filter((s) => s.tracked).length ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-800 opacity-60'
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm">🚀</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-white">مراجعة ونشر</span>
              <span className="block text-sm text-slate-400">عند إكمال كل الخطوات الأساسية تصبح عيادتك جاهزة لاستقبال المرضى عبر الـAI.</span>
            </span>
            {done === STEPS.filter((s) => s.tracked).length && <span className="text-sm font-semibold text-cyan-300">جاهزة ✓</span>}
          </div>
        </li>
      </ol>
    </DashboardSection>
  );
}
