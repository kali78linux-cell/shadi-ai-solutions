export type Appointment = {
  id: number | string;
  clinic_id?: string;
  patient_id?: string | null;
  patient_name: string;
  service: string;
  appointment_date: string;
  appointment_time: string;
  scheduled_at?: string | null;
  duration_minutes?: number;
  provider_id?: string | null;
  status: 'tentative' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | string;
};
