'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, GripVertical, ListTodo } from 'lucide-react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import { useClinicContext } from '@/lib/useClinicContext';

type Appointment = {
  id: number;
  patient_name: string;
  service: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  provider_id?: string | null;
  provider_name?: string | null;
};

type ViewMode = 'week' | 'day';

const statusToneMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  confirmed: 'success',
  scheduled: 'neutral',
  pending: 'warning',
  cancelled: 'danger',
  completed: 'success',
  no_show: 'danger',
};

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AppointmentsPage() {
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('week');
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState({ patient_id: '', service: 'تنظيف أسنان', appointment_date: '', appointment_time: '09:00', status: 'scheduled' });
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<string[]>([]);
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduleSaving, setRescheduleSaving] = useState(false);

  async function loadAppointments(id: string) {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const [appointmentsResponse, patientsResponse] = await Promise.all([
        fetch(`/api/appointments?clinic_id=${encodeURIComponent(id)}`, { headers }),
        fetch(`/api/patients?clinic_id=${encodeURIComponent(id)}`, { headers }),
      ]);
      if (!appointmentsResponse.ok || !patientsResponse.ok) {
        throw new Error('Appointments API unavailable');
      }
      const appointmentPayload = await appointmentsResponse.json();
      const patientPayload = await patientsResponse.json();
      const appointmentData = Array.isArray(appointmentPayload?.data) ? appointmentPayload.data : Array.isArray(appointmentPayload) ? appointmentPayload : [];
      const patientData = Array.isArray(patientPayload) ? patientPayload : [];
      setAppointments(appointmentData as Appointment[]);
      setPatients(patientData.map((patient: any) => ({ id: patient.id, name: patient.name })));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (clinicLoading) {
      setLoading(true);
      return;
    }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void loadAppointments(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicLoading, clinicId]);

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

  async function handleCreateAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clinicId) return;
    setSubmitting(true);
    try {
      const auth = await authHeaders();
      const response = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          clinic_id: clinicId,
          patient_id: formState.patient_id || null,
          service: formState.service.trim(),
          appointment_date: formState.appointment_date,
          duration_minutes: 30,
          provider_id: null,
          status: formState.status,
        }),
      });
      if (!response.ok) throw new Error('Unable to create appointment');
      const createdPayload = await response.json();
      const created = createdPayload?.data ?? createdPayload;
      setAppointments((current) => [{
        id: created?.id ?? Date.now(),
        patient_name: patients.find((patient) => patient.id === formState.patient_id)?.name ?? 'Unknown patient',
        service: created?.service ?? formState.service,
        appointment_date: created?.appointment_date ?? formState.appointment_date,
        appointment_time: created?.appointment_time ?? formState.appointment_time,
        status: created?.status ?? formState.status,
        provider_name: created?.provider_name ?? null,
      }, ...current]);
      setIsFormOpen(false);
      setFormState({ patient_id: '', service: 'تنظيف أسنان', appointment_date: '', appointment_time: '09:00', status: 'scheduled' });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save appointment');
    } finally {
      setSubmitting(false);
    }
  }

  async function openReschedule(appointment: Appointment) {
    setRescheduleTarget(appointment);
    setRescheduleDate('');
    setRescheduleSlots([]);
    setRescheduleError(null);
  }

  async function loadRescheduleSlots() {
    if (!rescheduleTarget || !clinicId || !rescheduleDate) return;
    setRescheduleLoading(true);
    setRescheduleError(null);
    setRescheduleSlots([]);
    try {
      const auth = await authHeaders();
      const providerId = rescheduleTarget.provider_id ?? rescheduleTarget.id;
      const res = await fetch(`/api/booking/availability?clinic_id=${encodeURIComponent(clinicId)}&provider_id=${encodeURIComponent(String(providerId))}&date=${encodeURIComponent(rescheduleDate)}`, { headers: auth });
      const body = await res.json();
      setRescheduleSlots(Array.isArray(body?.data?.slots) ? body.data.slots : []);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : 'Failed to load slots');
    } finally {
      setRescheduleLoading(false);
    }
  }

  async function confirmReschedule(slot: string) {
    if (!rescheduleTarget || !clinicId || !rescheduleDate) return;
    setRescheduleSaving(true);
    setRescheduleError(null);
    try {
      const auth = await authHeaders();
      const time = slot.slice(11, 16);
      const res = await fetch(`/api/appointments/reschedule?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          appointment_id: String(rescheduleTarget.id),
          date: rescheduleDate,
          time,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to reschedule');
      const updated = body?.data;
      setAppointments((current) => current.map((a) => a.id === rescheduleTarget.id ? { ...a, ...updated, appointment_date: rescheduleDate, appointment_time: time } : a));
      setRescheduleTarget(null);
      setRescheduleDate('');
      setRescheduleSlots([]);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : 'Failed to reschedule');
    } finally {
      setRescheduleSaving(false);
    }
  }

  async function updateAppointmentStatus(appointment: Appointment, status: string) {
    if (!clinicId) return;
    try {
      const auth = await authHeaders();
      const response = await fetch(`/api/appointments?clinic_id=${encodeURIComponent(clinicId)}&appointment_id=${appointment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Unable to update appointment');
      const payload = await response.json();
      const updated = payload?.data ?? payload;
      setAppointments((current) => current.map((a) => a.id === appointment.id ? { ...a, ...updated } : a));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to update appointment');
    }
  }

  return (
    <div className="space-y-6">
      <DashboardSection title="Appointments" subtitle="Calendar, day and week scheduling, and drag-and-drop rescheduling flow.">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setView('week')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'week' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>Week view</button>
          <button type="button" onClick={() => setView('day')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'day' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>Day view</button>
          <button type="button" onClick={() => setIsFormOpen((current) => !current)} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Create appointment</button>
        </div>

        {rescheduleTarget && (
          <div className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm font-semibold text-white">Reschedule Appointment</p>
            <p className="mt-1 text-xs text-slate-400">{rescheduleTarget.patient_name} — {rescheduleTarget.service}</p>
            {rescheduleError && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{rescheduleError}</div>}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">New date</label>
                <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={loadRescheduleSlots} disabled={!rescheduleDate || rescheduleLoading} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                  {rescheduleLoading ? 'Loading...' : 'Show slots'}
                </button>
              </div>
            </div>
            <div className="mt-4">
              {rescheduleLoading ? (
                <p className="text-sm text-slate-400">Loading available slots...</p>
              ) : rescheduleSlots.length === 0 && rescheduleDate ? (
                <p className="text-sm text-slate-500">No available slots for this date.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {rescheduleSlots.map((slot) => (
                    <button key={slot} type="button" onClick={() => confirmReschedule(slot)} disabled={rescheduleSaving} className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300 disabled:opacity-60">
                      {slot.slice(11, 16)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={() => { setRescheduleTarget(null); setRescheduleDate(''); setRescheduleSlots([]); setRescheduleError(null); }} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
            </div>
          </div>
        )}

        {isFormOpen ? (
          <form onSubmit={handleCreateAppointment} className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <select value={formState.patient_id} onChange={(event) => setFormState((current) => ({ ...current, patient_id: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required>
                <option value="">Select patient</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
              </select>
              <input value={formState.service} onChange={(event) => setFormState((current) => ({ ...current, service: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
              <input type="date" value={formState.appointment_date} onChange={(event) => setFormState((current) => ({ ...current, appointment_date: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
              <input type="time" value={formState.appointment_time} onChange={(event) => setFormState((current) => ({ ...current, appointment_time: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
            </div>
            <div className="mt-4 flex gap-3">
              <button type="submit" disabled={submitting} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{submitting ? 'Saving...' : 'Save appointment'}</button>
              <button type="button" onClick={() => setIsFormOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
            </div>
            {error && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
          </form>
        ) : null}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
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
                        {appointment.provider_name && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                            <ListTodo size={13} />
                            <span>{appointment.provider_name}</span>
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                          <GripVertical size={13} />
                          <span>Drag to reschedule</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {appointment.status !== 'confirmed' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                            <button type="button" onClick={() => updateAppointmentStatus(appointment, 'confirmed')} className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">Confirm</button>
                          )}
                          {appointment.status !== 'completed' && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
                            <button type="button" onClick={() => updateAppointmentStatus(appointment, 'completed')} className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25">Complete</button>
                          )}
                          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                            <button type="button" onClick={() => updateAppointmentStatus(appointment, 'cancelled')} className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/25">Cancel</button>
                          )}
                          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                            <button type="button" onClick={() => updateAppointmentStatus(appointment, 'no_show')} className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25">No-show</button>
                          )}
                          {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                            <button type="button" onClick={() => openReschedule(appointment)} className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/25">Reschedule</button>
                          )}
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