'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import { appointmentStatusAr, formatTimeAr, COMMUNICATION_STATUS_AR, COMMUNICATION_CHANNEL_AR } from '@/lib/dashboard/labels-ar';

function formatDateAr(iso: string | null): string {
  if (!iso) return 'بدون تاريخ';
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; }
}
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import PatientFinancialFilesPanel from '@/components/dashboard/patients/PatientFinancialFilesPanel';
import { useClinicContext } from '@/lib/useClinicContext';
import { useRouter } from 'next/navigation';

type PatientRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status?: string;
  notes?: string | null;
};

type PatientAppointment = {
  id: string;
  service: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  provider_name?: string | null;
};

type PatientCommunication = {
  id: string;
  type: string;
  channel: string;
  status: string;
  scheduled_for: string | null;
  sent_at: string | null;
  failed_at: string | null;
  attempt_count: number;
  last_error: string | null;
  appointment_id: string | null;
  created_at: string;
};

export default function PatientsPage() {
  const router = useRouter();
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<PatientRecord | null>(null);
  const [formState, setFormState] = useState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [patientAppointments, setPatientAppointments] = useState<PatientAppointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [communications, setCommunications] = useState<PatientCommunication[]>([]);
  const [communicationsLoading, setCommunicationsLoading] = useState(false);

  async function loadPatients(id: string, search?: string) {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const qs = new URLSearchParams({ clinic_id: id });
      if (search) qs.set('q', search);
      const res = await fetch(`/api/patients?${qs.toString()}`, { headers });
      if (!res.ok) throw new Error('بيانات المرضى غير متاحة');
      const data = await res.json();
      const records = Array.isArray(data) ? data : [];
      setPatients(records);
      setSelectedId((current) => current ?? records[0]?.id ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'حدث خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }

  // Load patients when the real clinic context resolves
  useEffect(() => {
    if (clinicLoading) {
      setLoading(true);
      return;
    }
    if (!clinicId) {
      if (clinicError) {
        setError(clinicError);
      }
      setLoading(false);
      return;
    }
    void loadPatients(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicLoading, clinicId]);

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return patients;
    return patients.filter((patient) => [patient.name, patient.email, patient.phone, patient.source, patient.status ?? ''].some((value) => value.toLowerCase().includes(normalized)));
  }, [patients, query]);

  const selectedPatient = filteredPatients.find((patient) => patient.id === selectedId) ?? filteredPatients[0] ?? null;

  // Load appointments for the selected patient
  useEffect(() => {
    if (!selectedPatient?.id || !clinicId) {
      setPatientAppointments([]);
      return;
    }
    let cancelled = false;
    setAppointmentsLoading(true);
    authHeaders().then((headers) => {
      fetch(`/api/appointments?clinic_id=${encodeURIComponent(clinicId)}`, { headers })
        .then(async (res) => {
          if (!res.ok) throw new Error('Failed to load appointments');
          return res.json();
        })
        .then((body) => {
          if (cancelled) return;
          const all = Array.isArray(body?.data) ? body.data : [];
          setPatientAppointments(all.filter((a: any) => a.patient_id === selectedPatient.id));
        })
        .catch(() => {
          if (!cancelled) setPatientAppointments([]);
        })
        .finally(() => {
          if (!cancelled) setAppointmentsLoading(false);
        });
    });
    return () => { cancelled = true; };
  }, [selectedPatient?.id, clinicId, authHeaders]);

  // Load communication history for the selected patient
  useEffect(() => {
    if (!selectedPatient?.id || !clinicId) {
      setCommunications([]);
      return;
    }
    let cancelled = false;
    setCommunicationsLoading(true);
    authHeaders().then((headers) => {
      fetch(`/api/clinic/patients/${selectedPatient.id}/communications?clinic_id=${encodeURIComponent(clinicId)}`, { headers })
        .then(async (res) => {
          if (!res.ok) throw new Error('Failed to load communications');
          return res.json();
        })
        .then((body) => {
          if (cancelled) return;
          setCommunications(Array.isArray(body?.data) ? body.data : []);
        })
        .catch(() => {
          if (!cancelled) setCommunications([]);
        })
        .finally(() => {
          if (!cancelled) setCommunicationsLoading(false);
        });
    });
    return () => { cancelled = true; };
  }, [selectedPatient?.id, clinicId, authHeaders]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formState.name.trim() || !clinicId) return;
    setSubmitting(true);
    setTimeout(() => {}, 0);
    try {
      const headers = await authHeaders();
      const url = editingPatient
        ? `/api/patients/${editingPatient.id}?clinic_id=${encodeURIComponent(clinicId)}`
        : '/api/patients';
      const response = await fetch(url, {
        method: editingPatient ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          ...(editingPatient ? { id: editingPatient.id } : {}),
          clinic_id: clinicId,
          name: formState.name,
          email: formState.email,
          phone: formState.phone,
          source: formState.source,
          status: formState.status,
          notes: formState.notes,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Unable to save patient');
      }
      const savedPatient = await response.json();
      setPatients((current) => {
        const next = editingPatient ? current.map((patient) => patient.id === editingPatient.id ? { ...patient, ...savedPatient } : patient) : [savedPatient, ...current];
        return next;
      });
      setSelectedId(savedPatient.id);
      setIsFormOpen(false);
      setEditingPatient(null);
      setFormState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to save patient');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(patientId: string) {
    if (!confirm('هل تريد حذف هذا المريض؟')) return;
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/patients/${patientId}?clinic_id=${encodeURIComponent(clinicId || '')}`, { method: 'DELETE', headers });
      if (!response.ok) throw new Error('Unable to delete patient');
      setPatients((current) => current.filter((patient) => patient.id !== patientId));
      if (selectedId === patientId) setSelectedId(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to delete patient');
    }
  }

  return (
    <DashboardSection title="المرضى" subtitle="ملفات مرضى شاملة مع سياق المواعيد والمحادثات.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex-1">
          <label htmlFor="patient-search" className="text-sm text-slate-400">البحث في المرضى</label>
          <input
            id="patient-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث بالاسم أو البريد أو الهاتف أو المصدر"
            className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>
        <button
          type="button"
          onClick={() => { setEditingPatient(null); setFormState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' }); setIsFormOpen((current) => !current); }}
          className="rounded-full bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950"
        >
          {isFormOpen ? 'إلغاء' : 'إضافة مريض'}
        </button>
      </div>

      {isFormOpen ? (
        <form onSubmit={handleSave} className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <input value={formState.name} onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))} placeholder="اسم المريض" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
            <input value={formState.email} onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))} placeholder="البريد الإلكتروني" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <input value={formState.phone} onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))} placeholder="رقم الهاتف" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <select value={formState.source} onChange={(event) => setFormState((current) => ({ ...current, source: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100">
              <option value="موقع الويب">الموقع الإلكتروني</option>
              <option value="الهاتف">الهاتف</option>
              <option value="الحضور">حضور مباشر</option>
            </select>
            <select value={formState.status} onChange={(event) => setFormState((current) => ({ ...current, status: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100">
              <option value="جديد">جديد</option>
              <option value="قيد المتابعة">قيد المتابعة</option>
              <option value="مؤكد">مؤكد</option>
            </select>
            <textarea value={formState.notes} onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))} placeholder="ملاحظات طبية" className="md:col-span-2 rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={submitting} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
              {submitting ? 'جارٍ الحفظ...' : editingPatient ? 'حفظ التعديلات' : 'إنشاء مريض'}
            </button>
            <button type="button" onClick={() => { setIsFormOpen(false); setEditingPatient(null); setFormState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' }); }} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">إلغاء</button>
          </div>
          {error && <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}
        </form>
      ) : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : error ? (
        <EmptyState title="خدمة المرضى غير متاحة" description={error} />
      ) : filteredPatients.length === 0 ? (
        <EmptyState title="لا يوجد مرضى بعد" description="ستظهر سجلات المرضى الجديدة هنا عند جمعها من سير التسجيل والحجز." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            {filteredPatients.map((patient) => (
              <div key={patient.id} className={`rounded-[1.5rem] border p-5 transition ${selectedPatient?.id === patient.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/70 hover:border-cyan-500/50'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{patient.name}</p>
                    <div className="mt-2 space-y-1 text-sm text-slate-300">
                      {patient.phone ? (<p className="flex items-center gap-2"><span>📞</span><span dir="ltr">{patient.phone}</span></p>) : null}
                      {patient.email ? (<p className="flex items-center gap-2 truncate"><span>✉️</span><span className="truncate" dir="ltr">{patient.email}</span></p>) : null}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">{patient.status ?? 'جديد'}</span>
                </div>
                <div className="mt-4 flex justify-end gap-x-4 gap-y-2 border-t border-slate-800 pt-3 text-sm">
                  <button type="button" onClick={() => setSelectedId(patient.id)} className="text-emerald-400 hover:text-emerald-300">عرض الملف</button>
                  <button type="button" onClick={() => { setEditingPatient(patient); setFormState({ name: patient.name, email: patient.email, phone: patient.phone, source: patient.source, status: patient.status ?? 'جديد', notes: patient.notes ?? '' }); setIsFormOpen(true); }} className="text-cyan-400 hover:text-cyan-300">تعديل</button>
                  <button type="button" onClick={() => handleDelete(patient.id)} className="text-red-400 hover:text-red-300">حذف</button>
                </div>
              </div>
            ))}
          </div>

          {selectedPatient ? (
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-sm text-slate-400">ملف المريض</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{selectedPatient.name}</h3>
              <p className="mt-2 text-sm text-slate-300">{selectedPatient.email}</p>
              <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                <div>المصدر: {selectedPatient.source}</div>
                <div>الهاتف: {selectedPatient.phone}</div>
                <div>الملاحظات: {selectedPatient.notes || 'لا توجد ملاحظات بعد.'}</div>
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-white">المواعيد</p>
                {appointmentsLoading ? (
                  <p className="mt-2 text-sm text-slate-400">جارٍ تحميل المواعيد...</p>
                ) : patientAppointments.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">لا توجد مواعيد بعد.</p>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {patientAppointments.map((appt) => (
                      <div key={appt.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-white">🦷 {appt.service ?? 'خدمة غير محددة'}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            appt.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-300' :
                            appt.status === 'cancelled' ? 'bg-red-500/15 text-red-300' :
                            appt.status === 'completed' ? 'bg-cyan-500/15 text-cyan-300' :
                            appt.status === 'no_show' ? 'bg-amber-500/15 text-amber-300' :
                            'bg-slate-800 text-slate-400'
                          }`}>{appointmentStatusAr(appt.status)}</span>
                        </div>
                        <div className="mt-3 space-y-1 text-sm text-slate-300">
                          <p>📅 {formatDateAr(appt.appointment_date)}</p>
                          <p>🕐 {formatTimeAr(appt.appointment_time ?? '')}</p>
                          {appt.provider_name ? <p>👨‍⚕️ {appt.provider_name}</p> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-white">سجل التواصل</p>
                {communicationsLoading ? (
                  <p className="mt-2 text-sm text-slate-400">جارٍ تحميل سجل التواصل...</p>
                ) : communications.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">لا توجد عمليات تواصل بعد.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {communications.map((comm) => (
                      <div key={comm.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">{comm.type}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            comm.status === 'sent' ? 'bg-emerald-500/15 text-emerald-300' :
                            comm.status === 'failed' ? 'bg-red-500/15 text-red-300' :
                            comm.status === 'cancelled' ? 'bg-slate-700 text-slate-400' :
                            comm.status === 'retried' ? 'bg-amber-500/15 text-amber-300' :
                            'bg-slate-800 text-slate-400'
                          }`}>{COMMUNICATION_STATUS_AR[comm.status] ?? comm.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          <span>{COMMUNICATION_CHANNEL_AR[comm.channel] ?? comm.channel}</span>
                          {comm.sent_at ? ` • أُرسلت: ${comm.sent_at.slice(0, 16).replace('T', ' ')}` : ''}
                          {comm.attempt_count > 0 ? ` • محاولات: ${comm.attempt_count}` : ''}
                        </div>
                        {comm.last_error && (
                          <div className="mt-1 text-xs text-red-400">خطأ: {comm.last_error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <PatientFinancialFilesPanel
                patientId={selectedPatient.id}
                patientName={selectedPatient.name}
              />
            </div>
          ) : null}
        </div>
      )}
    </DashboardSection>
  );
}
