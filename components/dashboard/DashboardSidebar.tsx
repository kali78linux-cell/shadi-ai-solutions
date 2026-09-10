'use client';

import { useClinicContext } from '@/lib/useClinicContext';
import ClinicSwitcher from '@/components/dashboard/ClinicSwitcher';
import DashboardNav from '@/components/dashboard/DashboardNav';

/**
 * TENANT-ISOLATED DASHBOARD — sidebar identity + navigation.
 * Brand and clinic name are Arabic-first; the nav is grouped, activity-aware
 * and points at the canonical tenant routes (see DashboardNav).
 */
export default function DashboardSidebar() {
  const { clinicName, loading } = useClinicContext();

  return (
    <div>
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-cyan-300/80">لوحة التحكم</p>
        <h1 className="mt-2 text-2xl font-semibold text-white">موظفة استقبال الأسنان الذكية</h1>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          إدارة المواعيد والرسائل والذكاء المالي والصفحة العامة في مكان واحد.
        </p>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <p className="text-xs text-slate-500">المؤسسة</p>
        <p className="mt-1 text-sm font-semibold text-slate-200">
          {loading ? 'جارٍ التحميل…' : clinicName ?? 'غير محددة'}
        </p>
      </div>

      <div className="mt-4">
        <ClinicSwitcher />
      </div>

      <div className="mt-6 border-t border-slate-800 pt-6">
        <DashboardNav />
      </div>
    </div>
  );
}