-- Phase: Real Environment Activation — Fix recursive RLS
-- Root cause: app_user_is_active_clinic_member() queries clinic_users,
-- and the clinic_users RLS policy calls that same function → infinite recursion.
-- Fix: Use a SECURITY DEFINER helper that bypasses RLS (owned by postgres),
-- with a fixed search_path, no dynamic SQL, and correct auth.uid() handling.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. SECURITY DEFINER helper for membership checks
-- =====================================================
-- This function runs with the privileges of the function owner (postgres),
-- so it bypasses RLS on clinic_users. It still enforces tenant isolation
-- by requiring auth.uid() to match a non-deleted clinic_users row.
-- search_path is fixed to prevent search-path hijacking.
-- No dynamic SQL. No secrets exposed.
CREATE OR REPLACE FUNCTION public.app_user_is_active_clinic_member_safe(clinic uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = clinic
      and cu.user_id = auth.uid()::uuid
      and cu.deleted_at is null
  );
$$;

-- =====================================================
-- 2. Fix the recursive clinic_users SELECT policy
-- =====================================================
-- The old policy called app_user_is_active_clinic_member(clinic_id),
-- which queried clinic_users → recursion.
-- The new policy uses the SECURITY DEFINER helper (no recursion).
DROP POLICY IF EXISTS "Clinic users can select memberships for self or clinic" ON public.clinic_users;
CREATE POLICY "Clinic users can select memberships for self or clinic"
  ON public.clinic_users FOR SELECT
  USING (
    app_is_super_admin()
    or user_id = app_current_user_id()
    or public.app_user_is_active_clinic_member_safe(clinic_id)
  );

-- =====================================================
-- 3. Fix the recursive clinic_users INSERT/UPDATE/DELETE policies
-- =====================================================
-- These used app_user_can_manage_clinic_users(clinic_id), which also
-- queries clinic_users → recursion. Replace with SECURITY DEFINER helper.
CREATE OR REPLACE FUNCTION public.app_user_can_manage_clinic_users_safe(clinic uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1
    from public.clinic_users cu
    where cu.clinic_id = clinic
      and cu.user_id = auth.uid()::uuid
      and cu.role in ('owner', 'admin')
      and cu.deleted_at is null
  );
$$;

DROP POLICY IF EXISTS "Clinic memberships can be managed by clinic owners and admins" ON public.clinic_users;
CREATE POLICY "Clinic memberships can be managed by clinic owners and admins"
  ON public.clinic_users FOR INSERT
  WITH CHECK (
    app_is_super_admin() or public.app_user_can_manage_clinic_users_safe(clinic_id)
  );

DROP POLICY IF EXISTS "Clinic memberships can be updated by clinic owners and admins" ON public.clinic_users;
CREATE POLICY "Clinic memberships can be updated by clinic owners and admins"
  ON public.clinic_users FOR UPDATE
  USING (
    app_is_super_admin() or public.app_user_can_manage_clinic_users_safe(clinic_id)
  )
  WITH CHECK (
    app_is_super_admin() or public.app_user_can_manage_clinic_users_safe(clinic_id)
  );

DROP POLICY IF EXISTS "Clinic memberships can be deleted by clinic owners and admins" ON public.clinic_users;
CREATE POLICY "Clinic memberships can be deleted by clinic owners and admins"
  ON public.clinic_users FOR DELETE
  USING (
    app_is_super_admin() or public.app_user_can_manage_clinic_users_safe(clinic_id)
  );

-- =====================================================
-- 4. Fix the recursive clinics SELECT policy
-- =====================================================
-- The clinics policy used app_user_is_active_clinic_member(id),
-- which queried clinic_users → recursion.
-- Replace with the SECURITY DEFINER helper.
DROP POLICY IF EXISTS "Clinics can be selected by clinic members or super admin" ON public.clinics;
CREATE POLICY "Clinics can be selected by clinic members or super admin"
  ON public.clinics FOR SELECT
  USING (
    app_is_super_admin() or public.app_user_is_active_clinic_member_safe(id)
  );

-- =====================================================
-- 5. Fix recursive policies on other tenant tables
-- =====================================================
-- All of these used app_user_is_active_clinic_member(clinic_id),
-- which recursed through clinic_users. Replace with the safe helper.

-- patients
DROP POLICY IF EXISTS "Clinic patients can be accessed by clinic members" ON public.patients;
CREATE POLICY "Clinic patients can be accessed by clinic members"
  ON public.patients FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic patients can be modified by active clinic members" ON public.patients;
CREATE POLICY "Clinic patients can be modified by active clinic members"
  ON public.patients FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic patients can be updated by active clinic members" ON public.patients;
CREATE POLICY "Clinic patients can be updated by active clinic members"
  ON public.patients FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic patients can be deleted by active clinic members" ON public.patients;
CREATE POLICY "Clinic patients can be deleted by active clinic members"
  ON public.patients FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- providers
DROP POLICY IF EXISTS "Clinic providers can be accessed by clinic members" ON public.providers;
CREATE POLICY "Clinic providers can be accessed by clinic members"
  ON public.providers FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic providers can be managed by active clinic members" ON public.providers;
CREATE POLICY "Clinic providers can be managed by active clinic members"
  ON public.providers FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic providers can be updated by active clinic members" ON public.providers;
CREATE POLICY "Clinic providers can be updated by active clinic members"
  ON public.providers FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic providers can be deleted by active clinic members" ON public.providers;
CREATE POLICY "Clinic providers can be deleted by active clinic members"
  ON public.providers FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- appointments
DROP POLICY IF EXISTS "Clinic appointments can be accessed by clinic members" ON public.appointments;
CREATE POLICY "Clinic appointments can be accessed by clinic members"
  ON public.appointments FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic appointments can be modified by active clinic members" ON public.appointments;
CREATE POLICY "Clinic appointments can be modified by active clinic members"
  ON public.appointments FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic appointments can be updated by active clinic members" ON public.appointments;
CREATE POLICY "Clinic appointments can be updated by active clinic members"
  ON public.appointments FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic appointments can be deleted by active clinic members" ON public.appointments;
CREATE POLICY "Clinic appointments can be deleted by active clinic members"
  ON public.appointments FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- conversations
DROP POLICY IF EXISTS "Clinic conversations can be accessed by clinic members" ON public.conversations;
CREATE POLICY "Clinic conversations can be accessed by clinic members"
  ON public.conversations FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic conversations can be modified by active clinic members" ON public.conversations;
CREATE POLICY "Clinic conversations can be modified by active clinic members"
  ON public.conversations FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic conversations can be updated by active clinic members" ON public.conversations;
CREATE POLICY "Clinic conversations can be updated by active clinic members"
  ON public.conversations FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic conversations can be deleted by active clinic members" ON public.conversations;
CREATE POLICY "Clinic conversations can be deleted by active clinic members"
  ON public.conversations FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- messages (uses conversation join)
DROP POLICY IF EXISTS "Clinic messages can be accessed by clinic members" ON public.messages;
CREATE POLICY "Clinic messages can be accessed by clinic members"
  ON public.messages FOR SELECT
  USING (
    app_is_super_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
        and public.app_user_is_active_clinic_member_safe(c.clinic_id)
    )
  );

DROP POLICY IF EXISTS "Clinic messages can be modified by clinic members" ON public.messages;
CREATE POLICY "Clinic messages can be modified by clinic members"
  ON public.messages FOR INSERT
  WITH CHECK (
    app_is_super_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
        and public.app_user_is_active_clinic_member_safe(c.clinic_id)
    )
  );

DROP POLICY IF EXISTS "Clinic messages can be updated by clinic members" ON public.messages;
CREATE POLICY "Clinic messages can be updated by clinic members"
  ON public.messages FOR UPDATE
  USING (
    app_is_super_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
        and public.app_user_is_active_clinic_member_safe(c.clinic_id)
    )
  )
  WITH CHECK (
    app_is_super_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
        and public.app_user_is_active_clinic_member_safe(c.clinic_id)
    )
  );

DROP POLICY IF EXISTS "Clinic messages can be deleted by clinic members" ON public.messages;
CREATE POLICY "Clinic messages can be deleted by clinic members"
  ON public.messages FOR DELETE
  USING (
    app_is_super_admin()
    or exists (
      select 1 from public.conversations c
      where c.id = public.messages.conversation_id
        and public.app_user_is_active_clinic_member_safe(c.clinic_id)
    )
  );

-- =====================================================
-- 6. Fix other tenant tables that use the recursive helper
-- =====================================================
-- leads
DROP POLICY IF EXISTS "Clinic leads can be accessed by clinic members" ON public.leads;
CREATE POLICY "Clinic leads can be accessed by clinic members"
  ON public.leads FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic leads can be modified by active clinic members" ON public.leads;
CREATE POLICY "Clinic leads can be modified by active clinic members"
  ON public.leads FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic leads can be updated by active clinic members" ON public.leads;
CREATE POLICY "Clinic leads can be updated by active clinic members"
  ON public.leads FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic leads can be deleted by active clinic members" ON public.leads;
CREATE POLICY "Clinic leads can be deleted by active clinic members"
  ON public.leads FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- knowledge_base
DROP POLICY IF EXISTS "Clinic knowledge articles can be accessed by clinic members" ON public.knowledge_base;
CREATE POLICY "Clinic knowledge articles can be accessed by clinic members"
  ON public.knowledge_base FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic knowledge articles can be modified by active clinic members" ON public.knowledge_base;
CREATE POLICY "Clinic knowledge articles can be modified by active clinic members"
  ON public.knowledge_base FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic knowledge articles can be updated by active clinic members" ON public.knowledge_base;
CREATE POLICY "Clinic knowledge articles can be updated by active clinic members"
  ON public.knowledge_base FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic knowledge articles can be deleted by active clinic members" ON public.knowledge_base;
CREATE POLICY "Clinic knowledge articles can be deleted by active clinic members"
  ON public.knowledge_base FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- subscriptions
DROP POLICY IF EXISTS "Clinic subscriptions can be accessed by clinic members" ON public.subscriptions;
CREATE POLICY "Clinic subscriptions can be accessed by clinic members"
  ON public.subscriptions FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic subscriptions can be managed by active clinic members" ON public.subscriptions;
CREATE POLICY "Clinic subscriptions can be managed by active clinic members"
  ON public.subscriptions FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic subscriptions can be updated by active clinic members" ON public.subscriptions;
CREATE POLICY "Clinic subscriptions can be updated by active clinic members"
  ON public.subscriptions FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic subscriptions can be deleted by active clinic members" ON public.subscriptions;
CREATE POLICY "Clinic subscriptions can be deleted by active clinic members"
  ON public.subscriptions FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- notifications
DROP POLICY IF EXISTS "Clinic notifications can be accessed by clinic members" ON public.notifications;
CREATE POLICY "Clinic notifications can be accessed by clinic members"
  ON public.notifications FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic notifications can be created by active clinic members" ON public.notifications;
CREATE POLICY "Clinic notifications can be created by active clinic members"
  ON public.notifications FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic notifications can be updated by active clinic members" ON public.notifications;
CREATE POLICY "Clinic notifications can be updated by active clinic members"
  ON public.notifications FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic notifications can be deleted by active clinic members" ON public.notifications;
CREATE POLICY "Clinic notifications can be deleted by active clinic members"
  ON public.notifications FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- audit_logs
DROP POLICY IF EXISTS "Clinic audit logs can be accessed by clinic members" ON public.audit_logs;
CREATE POLICY "Clinic audit logs can be accessed by clinic members"
  ON public.audit_logs FOR SELECT
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic audit logs can be created by active clinic members" ON public.audit_logs;
CREATE POLICY "Clinic audit logs can be created by active clinic members"
  ON public.audit_logs FOR INSERT
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic audit logs can be updated by active clinic members" ON public.audit_logs;
CREATE POLICY "Clinic audit logs can be updated by active clinic members"
  ON public.audit_logs FOR UPDATE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic audit logs can be deleted by active clinic members" ON public.audit_logs;
CREATE POLICY "Clinic audit logs can be deleted by active clinic members"
  ON public.audit_logs FOR DELETE
  USING (app_is_super_admin() or public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- 7. Fix provider_schedules / provider_vacations / clinic_holidays
-- =====================================================
DROP POLICY IF EXISTS provider_schedules_member_policy ON public.provider_schedules;
CREATE POLICY provider_schedules_member_policy
  ON public.provider_schedules FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS provider_vacations_member_policy ON public.provider_vacations;
CREATE POLICY provider_vacations_member_policy
  ON public.provider_vacations FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS clinic_holidays_member_policy ON public.clinic_holidays;
CREATE POLICY clinic_holidays_member_policy
  ON public.clinic_holidays FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS notification_queue_member_policy ON public.notification_queue;
CREATE POLICY notification_queue_member_policy
  ON public.notification_queue FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- 8. Fix clinic_services (from 20260809 migration)
-- =====================================================
DROP POLICY IF EXISTS "Clinic services can be accessed by clinic members" ON public.clinic_services;
CREATE POLICY "Clinic services can be accessed by clinic members"
  ON public.clinic_services FOR SELECT
  USING (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic services can be managed by active clinic members" ON public.clinic_services;
CREATE POLICY "Clinic services can be managed by active clinic members"
  ON public.clinic_services FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- 9. Fix provider_services (from 20260813 migration)
-- =====================================================
DROP POLICY IF EXISTS "Provider services can be read by clinic members" ON public.provider_services;
CREATE POLICY "Provider services can be read by clinic members"
  ON public.provider_services FOR SELECT
  USING (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Provider services can be managed by clinic members" ON public.provider_services;
CREATE POLICY "Provider services can be managed by clinic members"
  ON public.provider_services FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- 10. Fix clinic_communication_settings (from 20260812)
-- =====================================================
DROP POLICY IF EXISTS "Clinic communication settings can be read by clinic members" ON public.clinic_communication_settings;
CREATE POLICY "Clinic communication settings can be read by clinic members"
  ON public.clinic_communication_settings FOR SELECT
  USING (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Clinic communication settings can be managed by clinic members" ON public.clinic_communication_settings;
CREATE POLICY "Clinic communication settings can be managed by clinic members"
  ON public.clinic_communication_settings FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- 11. Fix clinic_notification_templates (from 20260815)
-- =====================================================
DROP POLICY IF EXISTS "Notification templates can be read by clinic members" ON public.clinic_notification_templates;
CREATE POLICY "Notification templates can be read by clinic members"
  ON public.clinic_notification_templates FOR SELECT
  USING (public.app_user_is_active_clinic_member_safe(clinic_id));

DROP POLICY IF EXISTS "Notification templates can be managed by clinic members" ON public.clinic_notification_templates;
CREATE POLICY "Notification templates can be managed by clinic members"
  ON public.clinic_notification_templates FOR ALL
  USING (public.app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member_safe(clinic_id));

-- =====================================================
-- End of migration
-- =====================================================