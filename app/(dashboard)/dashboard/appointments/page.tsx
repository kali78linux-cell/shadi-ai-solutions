'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, GripVertical, ListTodo } from 'lucide-react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import { isSupabaseConfigured } from '@/lib/supabase';

type Appointment = {
  id: number;
  patient_name: string;
  service: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
};

type ViewMode = 'week' | 'day';

const statusToneMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  confirmed: 'success',
  scheduled: 'neutral',
  pending: 'warning',
  cancelled: 'danger',
};

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('week');
  const [draggingId, setDraggingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAppointments() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/appointments');
        if (!response.ok) {
          throw new Error('Appointments API unavailable');
        }

        const payload = await response.json();
        const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];

        if (isMounted) {
          setAppointments(data as Appointment[]);
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadAppointments();
    return () => {
      isMounted = false;
    };
  }, []);

  const weekAppointments = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + 1);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const isoDate = date.toISOString().slice(0, 10);
      const items = appointments.filter((item) => item.appointment_date === isoDate);
      return { date, isoDate, items };
    });
  }, [appointments]);

  const headers = view === 'week' ? weekAppointments : weekAppointments.slice(0, 1);

  return (
    <div className="space-y-6">
      <DashboardSection title="Appointments" subtitle="Calendar, day and week scheduling, and drag-and-drop rescheduling flow.">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setView('week')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'week' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>Week view</button>
          <button type="button" onClick={() => setView('day')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'day' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>Day view</button>
        </div>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : !isSupabaseConfigured ? (
          <EmptyState title="Supabase is not configured" description="Live appointment scheduling data is unavailable until the backend clinic connection is active." />
        ) : error ? (
          <EmptyState title="Appointments service unavailable" description={error} />
        ) : appointments.length === 0 ? (
          <EmptyState title="No appointments scheduled" description="Appointments created through the clinic workflow will appear here in the calendar view." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
            {headers.map((column) => (
              <div key={column.isoDate} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4" onDragOver={(event) => event.preventDefault()} onDrop={() => {
                if (draggingId !== null) {
                  setAppointments((current) => current.map((appointment) => appointment.id === draggingId ? { ...appointment, appointment_date: column.isoDate } : appointment));
                  setDraggingId(null);
                }
              }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">{dayNames[Number(column.date.getDay()) === 0 ? 6 : Number(column.date.getDay()) - 1]}</p>
                  <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">{column.isoDate.slice(5)}</span>
                </div>
                <div className="mt-4 space-y-3">
                  {column.items.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-400">No bookings</div>
                  ) : (
                    column.items.map((appointment) => (
                      <article key={appointment.id} draggable onDragStart={() => setDraggingId(appointment.id)} className="cursor-grab rounded-2xl border border-slate-800 bg-slate-900/80 p-3 transition hover:-translate-y-0.5 hover:border-cyan-500/50">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{appointment.patient_name}</p>
                          <StatusPill tone={statusToneMap[appointment.status] ?? 'neutral'}>{appointment.status}</StatusPill>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                          <Clock3 size={13} />
                          <span>{appointment.appointment_time}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                          <CalendarDays size={13} />
                          <span>{appointment.service}</span>
                        </div>
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                          <GripVertical size={13} />
                          <span>Drag to reschedule</span>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
