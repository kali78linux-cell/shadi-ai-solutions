'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical } from 'lucide-react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import StatusPill from '@/components/dashboard/StatusPill';
import ConfirmDialog from '@/components/dashboard/ConfirmDialog';
import WaitlistManager from '@/components/dashboard/clinic/WaitlistManager';
import { useClinicContext } from '@/lib/useClinicContext';
import { dashboardStatus } from '@/lib/i18n';
import { getWeekDays, localIsoDate, mondayIndex, type WeekDay } from '@/lib/calendar/weeks';

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

const dayNames = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// Accent palette for each weekday card (medical + calm + modern).
const dayAccents = [
  { ring: 'border-sky-500/30', grad: 'from-sky-500/20 to-blue-500/5', text: 'text-sky-300', badge: 'bg-sky-500/20 text-sky-100 border-sky-400/40', dot: 'bg-sky-400' },
  { ring: 'border-cyan-500/30', grad: 'from-cyan-500/20 to-teal-500/5', text: 'text-cyan-300', badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-400/40', dot: 'bg-cyan-400' },
  { ring: 'border-teal-500/30', grad: 'from-teal-500/20 to-emerald-500/5', text: 'text-teal-300', badge: 'bg-teal-500/20 text-teal-100 border-teal-400/40', dot: 'bg-teal-400' },
  { ring: 'border-emerald-500/30', grad: 'from-emerald-500/20 to-green-500/5', text: 'text-emerald-300', badge: 'bg-emerald-500/20 text-emerald-100 border-emerald-400/40', dot: 'bg-emerald-400' },
  { ring: 'border-indigo-500/30', grad: 'from-indigo-500/20 to-violet-500/5', text: 'text-indigo-300', badge: 'bg-indigo-500/20 text-indigo-100 border-indigo-400/40', dot: 'bg-indigo-400' },
  { ring: 'border-violet-500/30', grad: 'from-violet-500/20 to-purple-500/5', text: 'text-violet-300', badge: 'bg-violet-500/20 text-violet-100 border-violet-400/40', dot: 'bg-violet-400' },
  { ring: 'border-rose-500/30', grad: 'from-rose-500/20 to-pink-500/5', text: 'text-rose-300', badge: 'bg-rose-500/20 text-rose-100 border-rose-400/40', dot: 'bg-rose-400' },
];

export default function AppointmentsPage() {
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>('week');
  // STEP 14E — week navigation offset (0 = current week, -1 = previous, 1 = next).
  const [weekOffset, setWeekOffset] = useState(0);
  // -1 means "auto": in day view, the currently displayed day follows the actual
  // weekday index of today inside whatever week is displayed.
  const [selectedDayIndex, setSelectedDayIndex] = useState(-1);
  // HTML5 drag & drop is unreliable with touch input; on coarse-pointer devices
  // the drag affordance is hidden and rescheduling goes through the existing
  // touch-friendly panel — same /api/appointments/reschedule path.
  const [isTouchDevice, setIsTouchDevice] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formState, setFormState] = useState({ patient_id: '', service: '', appointment_date: '', appointment_time: '09:00', status: 'scheduled' });
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [dropSavingId, setDropSavingId] = useState<number | null>(null);
  const [dropFeedback, setDropFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ appointment: Appointment; status: string; label: string } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
      setError(caughtError instanceof Error ? caughtError.message : 'حدث خطأ غير معروف');
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
    void loadServices(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicLoading, clinicId]);

  // Touch detection (STEP 14E): react to pointer-type changes (e.g. hybrid
  // laptops with touch screens) instead of assuming desktop at mount time.
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouchDevice(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  // Load the clinic's real services (same public endpoint used by the booking flow).
  // No hardcoded fallback service — if none exist, the form shows a clear state.
  async function loadServices(id: string) {
    setServicesLoading(true);
    try {
      const response = await fetch(`/api/booking/services?clinic_id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('Services API unavailable');
      const payload = await response.json();
      const list = Array.isArray(payload?.data?.services) ? payload.data.services : [];
      setServices(
        list
          .filter((service: any) => service && typeof service.name === 'string' && service.name.trim())
          .map((service: any) => ({ id: String(service.id ?? service.name), name: service.name })),
      );
    } catch {
      setServices([]);
    } finally {
      setServicesLoading(false);
    }
  }

  // STEP 14E — week/day calendar derived from local-date helpers (Monday-first).
  // Day keys use the LOCAL calendar date (never toISOString().slice) so the
  // column matching stays correct for clinics whose timezone is ahead of UTC.
  const { days, todayIsoStr, currentWeekdayIndex } = useMemo(() => {
    const today = new Date();
    return {
      days: getWeekDays(weekOffset, today),
      todayIsoStr: localIsoDate(today),
      currentWeekdayIndex: mondayIndex(today),
    };
  }, [weekOffset]);

  const columns = useMemo(
    () => days.map((day) => ({ ...day, items: appointments.filter((item) => item.appointment_date === day.isoDate) })),
    [days, appointments],
  );

  const effectiveDayIndex = selectedDayIndex === -1 ? currentWeekdayIndex : selectedDayIndex;
  const headers = view === 'week' ? columns : [columns[effectiveDayIndex]];

  function formatWeekLabel(list: WeekDay[]): string {
    const parse = (iso: string) => {
      const [year, month, day] = iso.split('-').map(Number);
      return { year, month, day };
    };
    const first = parse(list[0].isoDate);
    const last = parse(list[6].isoDate);
    if (first.month === last.month) return `${first.day} – ${last.day} ${monthNames[first.month - 1]} ${first.year}`;
    return `${first.day} ${monthNames[first.month - 1]} – ${last.day} ${monthNames[last.month - 1]} ${last.year}`;
  }

  function formatDayLabel(day: WeekDay): string {
    const [year, month, dayOfMonth] = day.isoDate.split('-').map(Number);
    return `${dayNames[day.dayIndex]} ${dayOfMonth} ${monthNames[month - 1]} ${year}`;
  }

  const calendarLabel = view === 'week' ? formatWeekLabel(days) : formatDayLabel(days[effectiveDayIndex]);

  const gridClasses = view === 'week'
    ? 'flex snap-x snap-mandatory gap-4 overflow-x-auto pb-4 xl:grid xl:grid-cols-2 xl:gap-4 xl:overflow-visible'
    : 'flex items-start justify-center gap-4 overflow-x-auto pb-4';

  function moveWeek(delta: number) {
    setWeekOffset((current) => current + delta);
  }

  function goToToday() {
    setWeekOffset(0);
    setSelectedDayIndex(-1);
  }

  function moveDay(delta: number) {
    const next = effectiveDayIndex + delta;
    if (next < 0) {
      setWeekOffset((current) => current - 1);
      setSelectedDayIndex(6);
    } else if (next > 6) {
      setWeekOffset((current) => current + 1);
      setSelectedDayIndex(0);
    } else {
      setSelectedDayIndex(next);
    }
  }

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
        patient_name: patients.find((patient) => patient.id === formState.patient_id)?.name ?? 'مريض غير معروف',
        service: created?.service ?? formState.service,
        appointment_date: created?.appointment_date ?? formState.appointment_date,
        appointment_time: created?.appointment_time ?? formState.appointment_time,
        status: created?.status ?? formState.status,
        provider_name: created?.provider_name ?? null,
      }, ...current]);
      setIsFormOpen(false);
      setFormState({ patient_id: '', service: '', appointment_date: '', appointment_time: '09:00', status: 'scheduled' });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر حفظ الموعد');
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
      setRescheduleError(e instanceof Error ? e.message : 'تعذر تحميل المواعيد المتاحة');
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
      if (!res.ok) throw new Error(body?.error || 'تعذر إعادة جدولة الموعد');
      const updated = body?.data;
      setAppointments((current) => current.map((a) => a.id === rescheduleTarget.id ? { ...a, ...updated, appointment_date: rescheduleDate, appointment_time: time } : a));
      setRescheduleTarget(null);
      setRescheduleDate('');
      setRescheduleSlots([]);
    } catch (e) {
      setRescheduleError(e instanceof Error ? e.message : 'تعذر إعادة جدولة الموعد');
    } finally {
      setRescheduleSaving(false);
    }
  }

  // Persist a drag & drop move through the existing reschedule API (same backend
  // rules: conflicts → 409, provider not assigned → 403). No optimistic update:
  // the card only moves when the server confirms, so a failed save never looks
  // successful. Concurrent drops are blocked while a request is in flight.
  async function handleDropMove(targetDate: string) {
    if (draggingId === null || dropSavingId !== null) return;
    const appointment = appointments.find((item) => item.id === draggingId);
    setDraggingId(null);
    if (!appointment || !clinicId) return;
    if (appointment.appointment_date === targetDate) return;
    const time = (appointment.appointment_time || '').slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setDropFeedback({ tone: 'error', message: 'تعذر إعادة جدولة هذا الموعد لعدم توفر وقت صالح.' });
      return;
    }
    setDropSavingId(appointment.id);
    setDropFeedback(null);
    try {
      const auth = await authHeaders();
      const response = await fetch(`/api/appointments/reschedule?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          appointment_id: String(appointment.id),
          date: targetDate,
          time,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'تعذر إعادة جدولة الموعد');
      const updated = body?.data ?? {};
      setAppointments((current) => current.map((item) => item.id === appointment.id
        ? { ...item, ...updated, appointment_date: targetDate, appointment_time: updated?.appointment_time ?? time }
        : item));
      setDropFeedback({ tone: 'success', message: `تم تحديث موعد ${appointment.patient_name} إلى ${targetDate} (${time}).` });
    } catch (caughtError) {
      setDropFeedback({
        tone: 'error',
        message: caughtError instanceof Error ? caughtError.message : 'تعذر إعادة جدولة الموعد',
      });
    } finally {
      setDropSavingId(null);
    }
  }

  // Low-risk, reversible status action (تأكيد) — kept direct without a dialog.
  async function confirmAppointment(appointment: Appointment) {
    if (!clinicId) return;
    try {
      const auth = await authHeaders();
      const response = await fetch(`/api/appointments?clinic_id=${encodeURIComponent(clinicId)}&appointment_id=${appointment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ status: 'confirmed' }),
      });
      if (!response.ok) throw new Error('Unable to update appointment');
      const payload = await response.json();
      const updated = payload?.data ?? payload;
      setAppointments((current) => current.map((a) => a.id === appointment.id ? { ...a, ...updated } : a));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'تعذر تحديث الموعد');
    }
  }

  function requestStatusChange(appointment: Appointment, status: string, label: string) {
    setConfirmError(null);
    setConfirmTarget({ appointment, status, label });
  }

  async function performStatusChange() {
    if (!confirmTarget || !clinicId) return;
    setConfirmPending(true);
    setConfirmError(null);
    try {
      const auth = await authHeaders();
      const response = await fetch(`/api/appointments?clinic_id=${encodeURIComponent(clinicId)}&appointment_id=${confirmTarget.appointment.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ status: confirmTarget.status }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'تعذر تحديث الموعد');
      const updated = payload?.data ?? payload;
      setAppointments((current) => current.map((a) => a.id === confirmTarget.appointment.id ? { ...a, ...updated } : a));
      setConfirmTarget(null);
    } catch (caughtError) {
      setConfirmError(caughtError instanceof Error ? caughtError.message : 'تعذر تحديث الموعد');
    } finally {
      setConfirmPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <DashboardSection title="المواعيد" subtitle="تقويم وجدولة يومية وأسبوعية وإعادة جدولة بالسحب والإفلات.">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setView('week')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'week' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>عرض الأسبوع</button>
          <button type="button" onClick={() => setView('day')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${view === 'day' ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}>عرض اليوم</button>
          <button type="button" onClick={() => setIsFormOpen((current) => !current)} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">إنشاء موعد</button>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => moveWeek(-1)} aria-label="الأسبوع السابق" title="الأسبوع السابق" className="flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300">
              <ChevronRight size={14} />
              <span>الأسبوع السابق</span>
            </button>
            <button type="button" onClick={goToToday} title="العودة إلى الأسبوع الحالي" className="rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300">
              الأسبوع الحالي
            </button>
            <button type="button" onClick={() => moveWeek(1)} aria-label="الأسبوع التالي" title="الأسبوع التالي" className="flex items-center gap-1 rounded-full border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300">
              <span>الأسبوع التالي</span>
              <ChevronLeft size={14} />
            </button>
          </div>
          <p className="text-sm font-semibold text-cyan-300">{calendarLabel}</p>
        </div>

        {view === 'day' && (
          <div className="mb-5 flex items-center gap-2">
            <button type="button" onClick={() => moveDay(-1)} aria-label="اليوم السابق" title="اليوم السابق" className="rounded-full border border-slate-700 p-2 text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300">
              <ChevronRight size={16} />
            </button>
            <div className="flex flex-1 flex-wrap items-center justify-center gap-2">
              {days.map((day, index) => (
                <button
                  key={day.isoDate}
                  type="button"
                  onClick={() => setSelectedDayIndex(index)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${index === effectiveDayIndex ? 'bg-cyan-500 text-slate-950' : 'border border-slate-700 text-slate-300 hover:border-cyan-500/70'}`}
                >
                  {dayNames[index]}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => moveDay(1)} aria-label="اليوم التالي" title="اليوم التالي" className="rounded-full border border-slate-700 p-2 text-slate-300 hover:border-cyan-500/70 hover:text-cyan-300">
              <ChevronLeft size={16} />
            </button>
          </div>
        )}

        {rescheduleTarget && (
          <div className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-sm font-semibold text-white">إعادة جدولة الموعد</p>
            <p className="mt-1 text-xs text-slate-400">{rescheduleTarget.patient_name} — {rescheduleTarget.service}</p>
            {rescheduleError && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{rescheduleError}</div>}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">التاريخ الجديد</label>
                <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={loadRescheduleSlots} disabled={!rescheduleDate || rescheduleLoading} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
                  {rescheduleLoading ? 'جارٍ التحميل...' : 'عرض المواعيد المتاحة'}
                </button>
              </div>
            </div>
            <div className="mt-4">
              {rescheduleLoading ? (
                <p className="text-sm text-slate-400">جارٍ تحميل المواعيد المتاحة...</p>
              ) : rescheduleSlots.length === 0 && rescheduleDate ? (
                <p className="text-sm text-slate-500">لا توجد مواعيد متاحة لهذا التاريخ.</p>
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
              <button type="button" onClick={() => { setRescheduleTarget(null); setRescheduleDate(''); setRescheduleSlots([]); setRescheduleError(null); }} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">إلغاء</button>
            </div>
          </div>
        )}

        {isFormOpen ? (
          <form onSubmit={handleCreateAppointment} className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <select value={formState.patient_id} onChange={(event) => setFormState((current) => ({ ...current, patient_id: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required>
                <option value="">اختر مريضاً</option>
                {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
              </select>
              <select value={formState.service} onChange={(event) => setFormState((current) => ({ ...current, service: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required disabled={servicesLoading}>
                <option value="">{servicesLoading ? 'جارٍ تحميل الخدمات...' : 'اختر الخدمة'}</option>
                {services.map((service) => <option key={service.id} value={service.name}>{service.name}</option>)}
              </select>
              <input type="date" value={formState.appointment_date} onChange={(event) => setFormState((current) => ({ ...current, appointment_date: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
              <input type="time" value={formState.appointment_time} onChange={(event) => setFormState((current) => ({ ...current, appointment_time: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
            </div>
            <div className="mt-4 flex gap-3">
              <button type="submit" disabled={submitting || services.length === 0} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{submitting ? 'جارٍ الحفظ...' : 'حفظ الموعد'}</button>
              <button type="button" onClick={() => setIsFormOpen(false)} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">إلغاء</button>
            </div>
            {error && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
            {!servicesLoading && services.length === 0 && (
              <p className="mt-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                لا توجد خدمات مفعّلة لهذه العيادة — أضف خدمة من صفحة «الخدمات» قبل إنشاء موعد.
              </p>
            )}
          </form>
        ) : null}

        {dropFeedback && (
          <div
            role={dropFeedback.tone === 'error' ? 'alert' : 'status'}
            className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${dropFeedback.tone === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'}`}
          >
            {dropFeedback.message}
          </div>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : error ? (
          <EmptyState title="خدمة المواعيد غير متاحة" description={error} />
        ) : appointments.length === 0 ? (
          <EmptyState title="لا توجد مواعيد مجدولة" description="ستظهر هنا المواعيد التي تم إنشاؤها من خلال سير عمل العيادة." />
        ) : (
          <div className={gridClasses}>
            {headers.map((column) => {
              const dayIndex = column.dayIndex;
              const accent = dayAccents[dayIndex] ?? dayAccents[0];
              const isToday = column.isoDate === todayIsoStr;
              const columnCardClass = view === 'week' ? 'w-[min(640px,92vw)] shrink-0 snap-center xl:w-auto' : 'w-[min(760px,100%)]';
              return (
              <div key={column.isoDate} className={`${columnCardClass} rounded-[1.5rem] border bg-slate-950/70 p-4 transition ${isToday ? 'border-cyan-500/60' : 'border-slate-800 hover:border-slate-700'}`} onDragOver={(event) => event.preventDefault()} onDrop={() => void handleDropMove(column.isoDate)}>
                <div className={`flex items-center justify-between gap-2 rounded-2xl bg-gradient-to-br ${accent.grad} px-3 py-2.5 border ${accent.ring}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${accent.dot}`} />
                    <p className={`text-sm font-bold ${accent.text}`}>{dayNames[dayIndex]}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${accent.badge}`}>{column.isoDate.slice(5)}</span>
                    {isToday && <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">اليوم</span>}
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {column.items.length === 0 ? (
                    <div className={`rounded-2xl border border-dashed px-3 py-8 text-center text-sm text-slate-400 ${accent.ring}`}>
                      <p className="text-3xl">🦷</p>
                      <p className="mt-2 text-slate-400">لا توجد حجوزات</p>
                      <p className="text-xs text-slate-500">اليوم متاح</p>
                    </div>
                  ) : (
                    column.items.map((appointment) => {
                      // Horizontal wide card — status accent (confirmed=green,
                      // pending=amber, cancelled=red, completed=cyan, no_show=slate).
                      const accentBorder =
                        appointment.status === 'confirmed' ? 'border-r-4 border-r-emerald-500' :
                        appointment.status === 'pending' || appointment.status === 'scheduled' ? 'border-r-4 border-r-amber-500' :
                        appointment.status === 'cancelled' ? 'border-r-4 border-r-red-500' :
                        appointment.status === 'completed' ? 'border-r-4 border-r-cyan-500' :
                        appointment.status === 'no_show' ? 'border-r-4 border-r-slate-500' : 'border-r-4 border-r-slate-700';
                      return (
                      <article key={appointment.id} draggable={!isTouchDevice && dropSavingId !== appointment.id} onDragStart={() => { if (!isTouchDevice && dropSavingId === null) setDraggingId(appointment.id); }} className={`rounded-2xl border border-slate-800 bg-slate-900/80 p-3 transition ${accentBorder} ${!isTouchDevice ? 'cursor-grab hover:-translate-y-0.5 hover:border-cyan-500/50' : ''} ${dropSavingId === appointment.id ? 'animate-pulse opacity-60' : ''}`}>
                        {/* Line 1: patient + time + service + doctor */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <p className="text-sm font-bold text-white">{appointment.patient_name}</p>
                          <span className="flex items-center gap-1 text-xs text-slate-300"><Clock3 size={12} />{appointment.appointment_time}</span>
                          <span className="text-xs text-slate-300">🦷 {appointment.service}</span>
                          {appointment.provider_name && <span className="text-xs text-slate-400">👨‍⚕️ {appointment.provider_name}</span>}
                        </div>
                        {/* Line 2: date + status + actions */}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <CalendarDays size={12} />
                            <span>{column.isoDate}</span>
                            <StatusPill tone={statusToneMap[appointment.status] ?? 'neutral'}>{dashboardStatus(appointment.status)}</StatusPill>
                            {!isTouchDevice && <span className="hidden items-center gap-1 text-slate-500 sm:flex"><GripVertical size={11} />اسحب لإعادة الجدولة</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {appointment.status !== 'confirmed' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                              <button type="button" onClick={() => confirmAppointment(appointment)} className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">تأكيد</button>
                            )}
                            {appointment.status !== 'completed' && appointment.status !== 'cancelled' && appointment.status !== 'no_show' && (
                              <button type="button" onClick={() => requestStatusChange(appointment, 'completed', 'تعليم الموعد كمكتمل')} className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/25">مكتمل</button>
                            )}
                            {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                              <button type="button" onClick={() => requestStatusChange(appointment, 'cancelled', 'إلغاء الموعد')} className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/25">إلغاء</button>
                            )}
                            {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                              <button type="button" onClick={() => requestStatusChange(appointment, 'no_show', 'تعليم الموعد كلم يحضر')} className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/25">لم يحضر</button>
                            )}
                            {appointment.status !== 'cancelled' && appointment.status !== 'completed' && appointment.status !== 'no_show' && (
                              <button type="button" onClick={() => openReschedule(appointment)} className="rounded-full bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-300 hover:bg-blue-500/25">إعادة الجدولة</button>
                            )}
                          </div>
                        </div>
                      </article>
                      );
                    })
                  )}
                </div>
              </div>
            );
            })}
          </div>
        )}

        <ConfirmDialog
          open={confirmTarget !== null}
          title={confirmTarget ? `${confirmTarget.label}` : ''}
          description={confirmTarget ? `سيتم تنفيذ «${confirmTarget.label}» على موعد ${confirmTarget.appointment.patient_name} (${confirmTarget.appointment.service}). هل تريد المتابعة؟` : ''}
          confirmLabel={confirmTarget?.label ?? 'تأكيد'}
          cancelLabel="رجوع"
          tone={confirmTarget?.status === 'cancelled' || confirmTarget?.status === 'no_show' ? 'danger' : 'primary'}
          pending={confirmPending}
          error={confirmError}
          onConfirm={() => void performStatusChange()}
          onClose={() => {
            if (!confirmPending) setConfirmTarget(null);
          }}
        />
      </DashboardSection>

      <DashboardSection title="قائمة الانتظار" subtitle="PHASE 2 — المرضى بانتظار موعد شاغر">
        <WaitlistManager />
      </DashboardSection>
    </div>
  );
}
