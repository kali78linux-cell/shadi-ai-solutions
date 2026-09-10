'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Users, MessageSquare, BellRing, Clock, ArrowUpRight, CalendarCheck2 } from 'lucide-react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/dashboard/EmptyState';
import StatusPill from '@/components/dashboard/StatusPill';
import { useSupabaseConfig } from '@/lib/useSupabaseConfig';
import { useClinicContext } from '@/lib/useClinicContext';
import { appointmentStatusAr, formatTimeAr, WEEKDAY_AR } from '@/lib/dashboard/labels-ar';

type OverviewAppointment = {
  id: string;
  date: string | null;
  time: string | null;
  status: string | null;
  patient_name: string | null;
};

type OverviewData = {
  patients_count: number;
  today_appointments: OverviewAppointment[];
  upcoming_appointments: OverviewAppointment[];
  appointments_count: number;
  new_conversations_count: number;
  needs_attention_count: number;
  generated_for_day: string;
};

function AppointmentCard({ item }: { item: OverviewAppointment }) {
  const dateLabel = item.date
    ? new Date(`${item.date}T00:00:00`).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' })
    : 'بدون تاريخ';
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-white">{item.patient_name ?? 'مريض بدون اسم'}</span>
        <StatusPill tone={item.status === 'confirmed' ? 'success' : item.status === 'cancelled' ? 'danger' : 'neutral'}>
          {appointmentStatusAr(item.status)}
        </StatusPill>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
        <span>📅 {dateLabel}</span>
        {item.time ? <span>🕐 {formatTimeAr(item.time)}</span> : null}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { isConfigured: isSupabaseConfigured, checkFailed } = useSupabaseConfig();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!clinicId) return;
      setLoading(true);
      setError(null);
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/clinic/overview?clinic_id=${encodeURIComponent(clinicId)}`, { headers });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'تعذر تحميل بيانات لوحة التحكم');
        if (mounted) setData(body.data as OverviewData);
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات لوحة التحكم');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    if (!isSupabaseConfigured && !checkFailed) { setLoading(false); return; }
    if (clinicLoading) { setLoading(true); return; }
    if (!clinicId) { setError(clinicError ?? 'لم يتم تحديد العيادة'); setLoading(false); return; }
    void load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupabaseConfigured, clinicLoading, clinicId]);

  const metricCards = data
    ? [
        { icon: <Users size={18} className="text-cyan-300" />, label: 'إجمالي المرضى', value: String(data.patients_count), href: '/dashboard/patients' },
        { icon: <CalendarDays size={18} className="text-emerald-300" />, label: 'مواعيد اليوم', value: String(data.today_appointments.length), href: '/dashboard/appointments' },
        { icon: <CalendarCheck2 size={18} className="text-cyan-300" />, label: 'المواعيد القادمة', value: String(data.upcoming_appointments.length), href: '/dashboard/appointments' },
        { icon: <MessageSquare size={18} className="text-violet-300" />, label: 'محادثات جديدة (7 أيام)', value: String(data.new_conversations_count), href: '/dashboard/conversations' },
        { icon: <BellRing size={18} className="text-amber-300" />, label: 'تحتاج متابعة الفريق', value: String(data.needs_attention_count), href: '/dashboard/conversations' },
      ]
    : [];

  return (
    <DashboardSection title="الرئيسية" subtitle="نظرة مباشرة على عمليات العيادة من البيانات الفعلية.">
      {!isSupabaseConfigured && !checkFailed ? (
        <EmptyState title="قاعدة البيانات غير مهيأة" description="فعّل بيئة العيادة الخلفية لعرض البيانات الحقيقية." />
      ) : loading || clinicLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32" />)}
          <Skeleton className="h-64 md:col-span-2 xl:col-span-3" />
          <Skeleton className="h-64 md:col-span-2 xl:col-span-2" />
        </div>
      ) : error ? (
        <EmptyState title="بيانات لوحة التحكم غير متاحة" description={error} />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {metricCards.map((card) => (
              <a key={card.label} href={card.href} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5 transition hover:border-cyan-500/50">
                <div className="flex items-center justify-between gap-3 text-sm text-slate-400">
                  <span>{card.label}</span>
                  {card.icon}
                </div>
                <p className="mt-3 text-3xl font-bold text-white">{card.value}</p>
              </a>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-[1.75rem] border border-slate-800 bg-slate-950/70 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Clock size={18} className="text-cyan-300" />
                  <h2 className="text-base font-semibold text-white">مواعيد اليوم</h2>
                </div>
                {data.generated_for_day ? (
                  <span className="text-xs text-slate-500">{WEEKDAY_AR[new Date(`${data.generated_for_day}T00:00:00`).getDay()]}</span>
                ) : null}
              </div>
              {data.today_appointments.length === 0 ? (
                <p className="mt-6 text-sm text-slate-500">لا توجد بيانات بعد — ستظهر مواعيد اليوم هنا.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {data.today_appointments.map((item) => <AppointmentCard key={item.id} item={item} />)}
                </div>
              )}
            </section>

            <section className="rounded-[1.75rem] border border-slate-800 bg-slate-950/70 p-5">
              <div className="flex items-center gap-3">
                <CalendarCheck2 size={18} className="text-emerald-300" />
                <h2 className="text-base font-semibold text-white">المواعيد القادمة</h2>
              </div>
              {data.upcoming_appointments.length === 0 ? (
                <p className="mt-6 text-sm text-slate-500">لا توجد بيانات بعد — ستظهر المواعيد القادمة هنا.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {data.upcoming_appointments.map((item) => <AppointmentCard key={item.id} item={item} />)}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-[1.75rem] border border-slate-800 bg-slate-950/70 p-5">
            <div className="flex items-center gap-3">
              <ArrowUpRight size={18} className="text-cyan-300" />
              <h2 className="text-base font-semibold text-white">إجراءات سريعة</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {[
                { label: 'مراجعة المواعيد', href: '/dashboard/appointments' },
                { label: 'فتح قائمة المرضى', href: '/dashboard/patients' },
                { label: 'محادثات الذكاء الاصطناعي', href: '/dashboard/conversations' },
                { label: 'قاعدة المعرفة', href: '/dashboard/knowledge-base' },
              ].map((action) => (
                <a key={action.href} href={action.href} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300 transition hover:border-cyan-500/60 hover:text-white">
                  {action.label}
                </a>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </DashboardSection>
  );
}
