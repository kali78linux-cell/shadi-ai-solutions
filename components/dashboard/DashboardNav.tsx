'use client';

import Link from 'next/link';
import { useClinicContext } from '@/lib/useClinicContext';
import { groupNavLinks, type NavModule } from '@/lib/services/dashboardNavModel';
import { tenantDashboardUrl } from '@/lib/services/dashboardPaths';

/**
 * TENANT-ISOLATED DASHBOARD — Arabic, grouped, role-gated sidebar navigation.
 *
 * `getActivityNavigation` is the single source of WHICH modules exist for an
 * activity type (clinic / imaging_center / dental_lab). `DashboardNav` renders
 * them grouped via `groupNavLinks` (NAV_GROUPS) and points every link at the
 * canonical tenant URL `/dashboard/{clinicSlug}/{module}` once the clinic
 * context resolves — before that it falls back to the flat path, which the
 * server compat-redirects to the canonical tenant route.
 */

/** Base navigation for a dental clinic — Arabic labels, canonical order. */
const BASE_NAV: NavModule[] = [
  { module: 'overview', label: 'الرئيسية' },
  { module: 'appointments', label: 'المواعيد' },
  { module: 'patients', label: 'المرضى' },
  { module: 'medical-files', label: 'الملفات الطبية' },
  { module: 'providers', label: 'الأطباء' },
  { module: 'services', label: 'الخدمات' },
  { module: 'team', label: 'إدارة الفريق' },
  { module: 'conversations', label: 'محادثات الذكاء الاصطناعي' },
  { module: 'messages', label: 'الرسائل' },
  { module: 'notifications', label: 'الإشعارات' },
  { module: 'leads', label: 'العملاء المحتملون' },
  { module: 'financial-intelligence', label: 'الذكاء المالي' },
  { module: 'analytics', label: 'التحليلات' },
  { module: 'growth', label: 'النمو' },
  { module: 'subscription', label: 'الاشتراك' },
  { module: 'knowledge-base', label: 'قاعدة المعرفة' },
  { module: 'public-page', label: 'الصفحة العامة' },
  { module: 'public-content', label: 'محتوى الصفحة العامة' },
  { module: 'profile', label: 'الملف الشخصي' },
  { module: 'ai-settings', label: 'إعدادات الذكاء الاصطناعي' },
  { module: 'communication-settings', label: 'إعدادات التواصل' },
  { module: 'ads', label: 'الإعلانات' },
  { module: 'imaging', label: 'الأشعة والتصوير' },
  { module: 'lab', label: 'المختبر' },
  { module: 'imaging-centers', label: 'مراكز الأشعة' },
  { module: 'clinic-setup', label: 'إعداد العيادة' },
  { module: 'setup', label: 'إعداد الحساب' },
];

/** Imaging-center workflow modules — inserted right after `overview`. */
const IMAGING_WORKFLOW: NavModule[] = [
  { module: 'imaging-requests', label: 'طلبات الأشعة' },
  { module: 'referring-clinics', label: 'العيادات المحوِّلة' },
];

/**
 * ACTIVITY-AWARE navigation. A dental clinic, an imaging center and a dental
 * lab are different businesses — they must not share one flat nav list.
 * `null` falls back to clinic navigation (backward compatible).
 */
export function getActivityNavigation(activity?: string | null): NavModule[] {
  const type = activity ?? 'clinic';
  let modules = [...BASE_NAV];

  if (type === 'imaging_center') {
    // An imaging center has no leads/growth funnel — it serves referring clinics.
    modules = modules.filter((m) => m.module !== 'leads' && m.module !== 'growth');
    const overviewIdx = modules.findIndex((m) => m.module === 'overview');
    modules.splice(overviewIdx + 1, 0, ...IMAGING_WORKFLOW);
  } else if (type === 'dental_lab') {
    // A lab receives cases from clinics — no appointments, no lead capture.
    modules = modules.filter((m) => m.module !== 'appointments' && m.module !== 'leads');
  }

  return modules;
}

// Role-gated modules. UI gating is convenience only — real enforcement happens
// in the API (roleDenied) and RLS.
const ADMIN_ONLY_MODULES = new Set(['providers', 'services', 'ai-settings', 'subscription', 'team', 'setup']);

export default function DashboardNav() {
  const { role, clinicSlug, activityType } = useClinicContext();
  const isAdmin = role === 'owner' || role === 'manager';
  const groups = groupNavLinks(getActivityNavigation(activityType));

  const hrefFor = (module: string): string =>
    clinicSlug ? tenantDashboardUrl(clinicSlug, module) : `/dashboard/${module}`;

  return (
    <nav aria-label="قائمة لوحة التحكم" className="space-y-5">
      {groups.map((group) => {
        const items = group.items.filter((item) => isAdmin || !ADMIN_ONLY_MODULES.has(item.module));
        if (items.length === 0) return null;
        return (
          <div key={group.id}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {group.icon} {group.label}
            </p>
            <div className="mt-2 space-y-1">
              {items.map((item) => (
                <Link
                  key={item.module}
                  href={hrefFor(item.module)}
                  className="block rounded-xl px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800/70 hover:text-white"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}