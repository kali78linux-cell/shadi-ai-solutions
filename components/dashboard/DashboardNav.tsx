'use client';

import Link from 'next/link';
import { useClinicContext } from '@/lib/useClinicContext';

// Role-gated navigation. UI gating is convenience only — real enforcement
// happens in the API (roleDenied) and RLS.
const ADMIN_ONLY = new Set(['/dashboard/providers', '/dashboard/services', '/dashboard/ai-settings', '/dashboard/subscription', '/dashboard/team', '/dashboard/setup']);

const LINKS: { href: string; label: string }[] = [
  { href: '/dashboard/overview', label: 'الرئيسية' },
  { href: '/dashboard/patients', label: 'المرضى' },
  { href: '/dashboard/appointments', label: 'المواعيد' },
  { href: '/dashboard/conversations', label: 'محادثات الذكاء الاصطناعي' },
  { href: '/dashboard/knowledge-base', label: 'قاعدة المعرفة' },
  { href: '/dashboard/providers', label: 'الأطباء' },
  { href: '/dashboard/services', label: 'الخدمات' },
  { href: '/dashboard/ai-settings', label: 'إعدادات الذكاء الاصطناعي' },
  { href: '/dashboard/setup', label: 'إعداد العيادة' },
  { href: '/dashboard/subscription', label: 'الاشتراك' },
];

export default function DashboardNav() {
  const { role } = useClinicContext();
  const isAdmin = role === 'owner' || role === 'manager';
  return (
    <>
      {LINKS.filter((l) => isAdmin || !ADMIN_ONLY.has(l.href)).map((l) => (
        <Link key={l.href} href={l.href} className="block rounded-xl px-3 py-2 transition hover:bg-slate-800/70 hover:text-white">
          {l.label}
        </Link>
      ))}
    </>
  );
}
