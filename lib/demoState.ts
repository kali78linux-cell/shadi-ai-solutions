import { randomUUID } from 'crypto';

type DemoPatient = {
  id: string;
  clinic_id: string;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  notes?: string | null;
};

type DemoAppointment = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  service: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  provider_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  notes?: string | null;
};

type DemoConversation = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  session_id: string;
  status: 'open' | 'awaiting_human' | 'closed';
  metadata?: Record<string, unknown>;
  started_at: string;
};

type DemoMessage = {
  id: string;
  conversation_id: string;
  clinic_id: string;
  role: 'patient' | 'assistant' | 'staff' | 'system';
  content: string;
  sender_id?: string | null;
  created_at: string;
};

const clinicId = '00000000-0000-0000-0000-000000000000';
const demoPatients: DemoPatient[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    clinic_id: clinicId,
    name: 'منى خالد',
    email: 'mona@example.com',
    phone: '+966500000001',
    source: 'موقع الويب',
    status: 'جديد',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: 'مريض جديد يحتاج متابعة.',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    clinic_id: clinicId,
    name: 'خالد سعيد',
    email: 'khaled@example.com',
    phone: '+966500000002',
    source: 'الهاتف',
    status: 'قيد المتابعة',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: 'إجراء متابعة بعد تنظيف الأسنان.',
  },
];

const demoAppointments: DemoAppointment[] = [
  {
    id: '33333333-3333-3333-3333-333333333333',
    clinic_id: clinicId,
    patient_id: demoPatients[0].id,
    service: 'تنظيف أسنان',
    appointment_date: new Date().toISOString().slice(0, 10),
    appointment_time: '09:00',
    duration_minutes: 30,
    provider_id: null,
    status: 'scheduled',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const demoConversations: DemoConversation[] = [];
const demoMessages: DemoMessage[] = [];

export function isDemoRequest(req?: Request) {
  const header = req?.headers.get('x-demo-session');
  return process.env.NODE_ENV !== 'production' && (header === 'true' || header === '1' || process.env.NEXT_PUBLIC_ENABLE_DEMO_FALLBACK === 'true');
}

export function getDemoPatients() {
  return demoPatients.map((patient) => ({ ...patient }));
}

export function createDemoPatient(input: Partial<DemoPatient> & Pick<DemoPatient, 'name'>): DemoPatient {
  const created: DemoPatient = {
    id: input.id ?? randomUUID(),
    clinic_id: input.clinic_id ?? clinicId,
    name: input.name,
    email: input.email ?? '',
    phone: input.phone ?? '',
    source: input.source ?? 'موقع الويب',
    status: input.status ?? 'جديد',
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    notes: input.notes ?? null,
  };
  demoPatients.unshift(created);
  return created;
}

export function updateDemoPatient(patientId: string, updates: Partial<DemoPatient>) {
  const index = demoPatients.findIndex((patient) => patient.id === patientId);
  if (index < 0) return null;
  const current = demoPatients[index];
  const next = { ...current, ...updates, updated_at: new Date().toISOString() };
  demoPatients[index] = next;
  return next;
}

export function deleteDemoPatient(patientId: string) {
  const index = demoPatients.findIndex((patient) => patient.id === patientId);
  if (index < 0) return false;
  demoPatients.splice(index, 1);
  return true;
}

export function getDemoAppointments() {
  return demoAppointments.map((appointment) => ({ ...appointment }));
}

export function createDemoAppointment(input: Partial<DemoAppointment> & Pick<DemoAppointment, 'service' | 'appointment_date'>): DemoAppointment {
  const created: DemoAppointment = {
    id: input.id ?? randomUUID(),
    clinic_id: input.clinic_id ?? clinicId,
    patient_id: input.patient_id ?? null,
    service: input.service,
    appointment_date: input.appointment_date,
    appointment_time: input.appointment_time ?? '09:00',
    duration_minutes: input.duration_minutes ?? 30,
    provider_id: input.provider_id ?? null,
    status: input.status ?? 'scheduled',
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    notes: input.notes ?? null,
  };
  demoAppointments.unshift(created);
  return created;
}

export function getDemoConversations() {
  return demoConversations.map((conversation) => ({ ...conversation }));
}

export function createDemoConversation(input: Partial<DemoConversation> & Pick<DemoConversation, 'clinic_id'>) {
  const created: DemoConversation = {
    id: input.id ?? randomUUID(),
    clinic_id: input.clinic_id,
    patient_id: input.patient_id ?? null,
    session_id: input.session_id ?? `sess:${Date.now()}`,
    status: input.status ?? 'open',
    metadata: input.metadata ?? {},
    started_at: input.started_at ?? new Date().toISOString(),
  };
  demoConversations.unshift(created);
  return created;
}

export function getDemoMessages(conversationId: string) {
  return demoMessages.filter((message) => message.conversation_id === conversationId).map((message) => ({ ...message }));
}

export function appendDemoMessage(input: Omit<DemoMessage, 'id' | 'created_at'>) {
  const created: DemoMessage = {
    id: randomUUID(),
    conversation_id: input.conversation_id,
    clinic_id: input.clinic_id,
    role: input.role,
    content: input.content,
    sender_id: input.sender_id ?? null,
    created_at: new Date().toISOString(),
  };
  demoMessages.push(created);
  return created;
}
