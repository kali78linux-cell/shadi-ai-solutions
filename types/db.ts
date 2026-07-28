export type Clinic = {
  id: string;
  name: string;
  slug: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  logo?: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type ClinicUser = {
  id: string;
  clinic_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'receptionist';
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Patient = {
  id: string;
  clinic_id: string;
  name: string;
  email: string;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Lead = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  source: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Appointment = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  service: string;
  appointment_date: string;
  scheduled_at?: string | null;
  duration_minutes: number;
  provider_id?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Conversation = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  session_id: string;
  status: string;
  conversation_state?: 'ai' | 'awaiting_staff' | 'assigned_staff' | 'resolved' | 'closed';
  intent?: string | null;
  intent_confidence?: number | null;
  urgency?: string | null;
  appointment_data?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: 'patient' | 'assistant' | 'staff' | 'system';
  content: string;
  content_json?: Record<string, unknown> | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  model?: string | null;
  response_time_ms?: number | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type ClinicKnowledgeDocument = {
  id: string;
  clinic_id: string;
  uploaded_by: string;
  original_filename: string;
  file_type: string;
  mime_type: string;
  file_size: number;
  checksum: string;
  language: string;
  storage_path?: string | null;
  upload_status: 'pending' | 'success' | 'failed';
  processing_status: 'pending' | 'chunking' | 'embedding' | 'indexed' | 'error' | 'processing';
  chunk_count?: number | null;
  embedding_model?: string | null;
  indexed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type KnowledgeBaseArticle = {
  id: string;
  clinic_id: string;
  title: string;
  content: string;
  category?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type ClinicAIKnowledge = {
  id: string;
  clinic_id: string;
  document_id?: string | null;
  type: 'structured' | 'unstructured';
  subtype?: string | null; // e.g. services, doctors, pricing, faq, document
  title?: string | null;
  content?: string | null;
  structured_data?: Record<string, unknown> | null;
  chunk_index?: number | null;
  source_type?: string | null;
  metadata?: Record<string, unknown> | null;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type ClinicAISettings = {
  id: string;
  clinic_id: string;
  assistant_name?: string | null;
  tone?: string | null;
  language?: string | null;
  greeting?: string | null;
  safety_controls?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type AILead = {
  id: string;
  clinic_id: string;
  conversation_id?: string | null;
  patient_contact?: Record<string, unknown> | null;
  score?: number | null;
  lead_temperature?: 'hot' | 'warm' | 'cold' | null;
  confidence?: number | null;
  intent?: string | null;
  urgency?: string | null;
  estimated_value?: number | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
};

export type AIEvent = {
  id: string;
  clinic_id: string;
  conversation_id?: string | null;
  event_type: string;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type AIUsage = {
  id: string;
  clinic_id: string;
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens: number;
  estimated_cost?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  created_at: string;
};

export type Subscription = {
  id: string;
  clinic_id: string;
  plan_id: string;
  billing_status: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_end?: string | null;
  cancel_at_period_end: boolean;
  billing_customer_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Provider = {
  id: string;
  clinic_id: string;
  user_id: string;
  provider_type: 'dentist' | 'hygienist' | 'staff';
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type Notification = {
  id: string;
  clinic_id: string;
  user_id?: string | null;
  patient_id?: string | null;
  appointment_id?: string | null;
  channel: 'email' | 'sms' | 'dashboard';
  type: 'appointment_reminder' | 'billing' | 'system' | 'human_handoff';
  payload: Record<string, unknown>;
  sent_at?: string | null;
  delivered_at?: string | null;
  failed_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type AuditLog = {
  id: string;
  clinic_id?: string | null;
  user_id?: string | null;
  action: string;
  resource?: string | null;
  resource_id?: string | null;
  details: Record<string, unknown>;
  severity: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};
