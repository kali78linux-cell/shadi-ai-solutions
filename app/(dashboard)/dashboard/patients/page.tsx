'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
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
      if (!res.ok) throw new Error('Patient data unavailable');
      const data = await res.json();
      const records = Array.isArray(data) ? data : [];
      setPatients(records);
      setSelectedId((current) => current ?? records[0]?.id ?? null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
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
    <DashboardSection title="Patients" subtitle="Rich profile workspace with appointment and conversation context.">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex-1">
          <label htmlFor="patient-search" className="text-sm text-slate-400">Search patients</label>
          <input
            id="patient-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, email, phone or source"
            className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
        </div>
        <button
          type="button"
          onClick={() => { setEditingPatient(null); setFormState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' }); setIsFormOpen((current) => !current); }}
          className="rounded-full bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950"
        >
          {isFormOpen ? 'إلغاء' : 'Add Patient'}
        </button>
      </div>

      {isFormOpen ? (
        <form onSubmit={handleSave} className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <input value={formState.name} onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))} placeholder="Patient name" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" required />
            <input value={formState.email} onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <input value={formState.phone} onChange={(event) => setFormState((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
            <select value={formState.source} onChange={(event) => setFormState((current) => ({ ...current, source: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100">
              <option value="موقع الويب">Website</option>
              <option value="الهاتف">Phone</option>
              <option value="الحضور">Walk-in</option>
            </select>
            <select value={formState.status} onChange={(event) => setFormState((current) => ({ ...current, status: event.target.value }))} className="rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100">
              <option value="جديد">New</option>
              <option value="قيد المتابعة">Follow-up</option>
              <option value="مؤكد">Confirmed</option>
            </select>
            <textarea value={formState.notes} onChange={(event) => setFormState((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="md:col-span-2 rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100" />
          </div>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={submitting} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">
              {submitting ? 'Saving...' : editingPatient ? 'Save changes' : 'Create patient'}
            </button>
            <button type="button" onClick={() => { setIsFormOpen(false); setEditingPatient(null); setFormState({ name: '', email: '', phone: '', source: 'موقع الويب', status: 'جديد', notes: '' }); }} className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300">Cancel</button>
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
        <EmptyState title="Patients service unavailable" description={error} />
      ) : filteredPatients.length === 0 ? (
        <EmptyState title="No patients yet" description="New patient records will appear here as they are captured from the intake and appointment flow." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            {filteredPatients.slice(0, 6).map((patient) => (
              <div key={patient.id} className={`w-full rounded-[1.5rem] border p-5 text-right transition ${selectedPatient?.id === patient.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/70 hover:border-cyan-500/50'}`}>
                <button type="button" onClick={() => setSelectedId(patient.id)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-lg font-semibold text-white">{patient.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{patient.email}</p>
                    </div>
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">{patient.status ?? 'New'}</span>
                  </div>
                  <div className="mt-4 text-sm text-slate-300">{patient.phone}</div>
                </button>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => { setEditingPatient(patient); setFormState({ name: patient.name, email: patient.email, phone: patient.phone, source: patient.source, status: patient.status ?? 'جديد', notes: patient.notes ?? '' }); setIsFormOpen(true); }} className="text-sm text-cyan-400">Edit</button>
                  <button type="button" onClick={() => handleDelete(patient.id)} className="text-sm text-red-400">Delete</button>
                </div>
              </div>
            ))}
          </div>

          {selectedPatient ? (
            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-sm text-slate-400">Patient profile</p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{selectedPatient.name}</h3>
              <p className="mt-2 text-sm text-slate-300">{selectedPatient.email}</p>
              <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                <div>Source: {selectedPatient.source}</div>
                <div>Phone: {selectedPatient.phone}</div>
                <div>Notes: {selectedPatient.notes || 'No notes yet.'}</div>
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-white">Appointments</p>
                {appointmentsLoading ? (
                  <p className="mt-2 text-sm text-slate-400">Loading appointments...</p>
                ) : patientAppointments.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No appointments yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {patientAppointments.map((appt) => (
                      <div key={appt.id} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-200">{appt.service}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            appt.status === 'confirmed' ? 'bg-emerald-500/15 text-emerald-300' :
                            appt.status === 'cancelled' ? 'bg-red-500/15 text-red-300' :
                            appt.status === 'completed' ? 'bg-cyan-500/15 text-cyan-300' :
                            appt.status === 'no_show' ? 'bg-amber-500/15 text-amber-300' :
                            'bg-slate-800 text-slate-400'
                          }`}>{appt.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {appt.appointment_date} • {appt.appointment_time}
                          {appt.provider_name ? ` • ${appt.provider_name}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-white">Communication History</p>
                {communicationsLoading ? (
                  <p className="mt-2 text-sm text-slate-400">Loading communications...</p>
                ) : communications.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No communications yet.</p>
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
                          }`}>{comm.status}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          <span className="capitalize">{comm.channel}</span>
                          {comm.sent_at ? ` • sent: ${comm.sent_at.slice(0, 16).replace('T', ' ')}` : ''}
                          {comm.attempt_count > 0 ? ` • attempts: ${comm.attempt_count}` : ''}
                        </div>
                        {comm.last_error && (
                          <div className="mt-1 text-xs text-red-400">Error: {comm.last_error}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </DashboardSection>
  );
}