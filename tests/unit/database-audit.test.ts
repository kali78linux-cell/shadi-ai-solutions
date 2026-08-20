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
      '20260721_initial_schema.sql',
      '20260722_ai_core_schema.sql',
      '20260722_production_schema.sql',
      '20260723000001_communication_gateway.sql',
      '20260723000002_conversation_intelligence.sql',
      '20260723_appointment_engine.sql',
      '20260724_communication_gateway.sql',
      '20260725_knowledge_documents.sql',
      '20260726_vector_search.sql',
      '20260727_usage_tracking_enhancements.sql',
      '20260728_conversation_intelligence.sql',
      '20260729_schema_reconciliation.sql',
      '20260809_booking_service_catalog.sql',
      '20260810_booking_confirmation_tokens.sql',
      '20260811_booking_communications.sql',
      '20260812_clinic_communication_settings.sql',
      '20260813_provider_schedule_assignment.sql',
      '20260814_booking_race_condition_fix.sql',
      '20260815_notification_templates_and_reminder_config.sql',
      '20260816_fix_recursive_rls.sql',
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
