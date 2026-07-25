'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { isSupabaseConfigured } from '@/lib/supabase';

type PatientRecord = {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: string;
  status?: string;
};

type AppointmentRecord = {
  id: number;
  patient_name: string;
  service: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
};

export default function PatientsPage() {
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadPatients() {
      setLoading(true);
      setError(null);

      try {
        const [patientsResponse, appointmentsResponse] = await Promise.all([
          fetch('/api/leads'),
          fetch('/api/appointments'),
        ]);

        if (!patientsResponse.ok || !appointmentsResponse.ok) {
          throw new Error('Patient data unavailable');
        }

        const data = await patientsResponse.json();
        const appointmentPayload = await appointmentsResponse.json();
        const appointmentData = Array.isArray(appointmentPayload?.data) ? appointmentPayload.data : Array.isArray(appointmentPayload) ? appointmentPayload : [];

        if (isMounted) {
          const patientRecords = Array.isArray(data) ? data : [];
          setPatients(patientRecords);
          setAppointments(appointmentData as AppointmentRecord[]);
          setSelectedId(patientRecords[0]?.id ?? null);
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

    loadPatients();
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredPatients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return patients;

    return patients.filter((patient) => [patient.name, patient.email, patient.phone, patient.source].some((value) => value.toLowerCase().includes(normalized)));
  }, [patients, query]);

  const selectedPatient = filteredPatients.find((patient) => patient.id === selectedId) ?? filteredPatients[0] ?? null;

  return (
    <DashboardSection title="Patients" subtitle="Rich profile workspace with appointment and conversation context.">
      <div className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
        <label htmlFor="patient-search" className="text-sm text-slate-400">Search patients</label>
        <input
          id="patient-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, email, phone or source"
          className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : !isSupabaseConfigured ? (
        <EmptyState title="Supabase is not configured" description="Enable your clinic backend to load live patient records from the existing APIs." />
      ) : error ? (
        <EmptyState title="Patients service unavailable" description={error} />
      ) : filteredPatients.length === 0 ? (
        <EmptyState title="No patients yet" description="New patient records will appear here as they are captured from the intake and appointment flow." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-4">
            {filteredPatients.slice(0, 6).map((patient) => (
              <button key={patient.id} type="button" onClick={() => setSelectedId(patient.id)} className={`w-full rounded-[1.5rem] border p-5 text-right transition ${selectedPatient?.id === patient.id ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-slate-800 bg-slate-950/70 hover:border-cyan-500/50'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-white">{patient.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{patient.email}</p>
                  </div>
                  <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">{patient.status ?? 'New'}</span>
                </div>
                <div className="mt-4 text-sm text-slate-300">{patient.phone}</div>
              </button>
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
                <div>Conversation summary: AI handoff is available through the patient intake workflow.</div>
              </div>
              <div className="mt-6 space-y-3">
                <p className="text-sm font-semibold text-white">Appointment history</p>
                {appointments.filter((item) => item.patient_name === selectedPatient.name).slice(0, 3).map((appointment) => (
                  <div key={appointment.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                    {appointment.appointment_date} • {appointment.appointment_time} • {appointment.service}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </DashboardSection>
  );
}
