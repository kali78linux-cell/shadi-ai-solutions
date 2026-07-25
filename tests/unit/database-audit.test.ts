import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const migrationDir = path.join(projectRoot, 'db', 'migrations');

const migrationFiles = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

describe('database migration audit', () => {
  it('keeps the migration sequence ordered by phase', () => {
    expect(migrationFiles).toEqual([
      '20260722_ai_core_schema.sql',
      '20260722_production_schema.sql',
      '20260723_appointment_engine.sql',
      '20260723_communication_gateway.sql',
      '20260723_conversation_intelligence.sql',
      '20260725_knowledge_documents.sql',
      '20260726_vector_search.sql',
    ]);
  });

  it('keeps core tenant indexes and trigger coverage in the production migration', () => {
    const production = fs.readFileSync(path.join(migrationDir, '20260722_production_schema.sql'), 'utf8');

    expect(production).toContain('idx_clinic_users_clinic_id');
    expect(production).toContain('idx_clinic_users_user_id');
    expect(production).toContain('idx_appointments_clinic_id_date_status');
    expect(production).toContain('idx_notifications_clinic_id');
    expect(production).toContain('set_updated_at_clinics');
    expect(production).toContain('set_updated_at_appointments');
    expect(production).toContain('set_updated_at_messages');
  });

  it('keeps appointment engine tables behind the expected RLS policy surface', () => {
    const appointmentEngine = fs.readFileSync(path.join(migrationDir, '20260723_appointment_engine.sql'), 'utf8');

    expect(appointmentEngine).toContain('ALTER TABLE public.provider_schedules ENABLE ROW LEVEL SECURITY;');
    expect(appointmentEngine).toContain('ALTER TABLE public.provider_vacations ENABLE ROW LEVEL SECURITY;');
    expect(appointmentEngine).toContain('ALTER TABLE public.clinic_holidays ENABLE ROW LEVEL SECURITY;');
    expect(appointmentEngine).toContain('ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;');
    expect(appointmentEngine).toContain('CREATE POLICY provider_schedules_member_policy ON public.provider_schedules FOR ALL');
    expect(appointmentEngine).toContain('CREATE POLICY notification_queue_member_policy ON public.notification_queue FOR ALL');
  });
});
