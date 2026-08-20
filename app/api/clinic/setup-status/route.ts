import { NextResponse } from 'next/server';
import { authorizeClinicRequest } from '@/lib/services/clinicAuthorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id is required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: authorization.status });
    }

    const supabase = supabaseAdmin;

    // 1. Clinic profile
    const { data: clinic, error: clinicError } = await supabase
      .from('clinics')
      .select('id, name, phone, address, website')
      .eq('id', clinicId)
      .is('deleted_at', null)
      .single();

    if (clinicError || !clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });

    const profileComplete = Boolean(clinic.name && clinic.phone && clinic.address);

    // 2. Active providers (not soft-deleted)
    const { data: providers, error: providersError } = await supabase
      .from('providers')
      .select('id')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null);

    if (providersError) throw new Error(providersError.message);
    const hasProvider = (providers ?? []).length > 0;

    // 3. Active services
    const { data: services, error: servicesError } = await supabase
      .from('clinic_services')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('active', true)
      .is('deleted_at', null);

    if (servicesError) throw new Error(servicesError.message);
    const hasService = (services ?? []).length > 0;

    // 4. Valid schedule for an active provider (at least one enabled day)
    let hasSchedule = false;
    if (hasProvider) {
      const providerIds = (providers ?? []).map((p) => p.id);
      const { data: schedules, error: schedulesError } = await supabase
        .from('provider_schedules')
        .select('provider_id')
        .eq('clinic_id', clinicId)
        .eq('enabled', true)
        .in('provider_id', providerIds);

      if (schedulesError) throw new Error(schedulesError.message);
      hasSchedule = (schedules ?? []).length > 0;
    }

    // 5. Provider ↔ Service assignment (when assignments are used)
    let hasAssignment = true; // Default true when no assignments exist (fallback mode)
    let assignmentStatus: 'ok' | 'missing' | 'not_used' = 'not_used';
    if (hasProvider && hasService) {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('provider_services')
        .select('provider_id, service_id')
        .eq('clinic_id', clinicId);

      if (!assignmentsError) {
        if ((assignments ?? []).length > 0) {
          // Assignments exist — check that at least one active provider has at least one active service
          const activeServiceIds = new Set((services ?? []).map((s) => s.id));
          const activeProviderIds = new Set((providers ?? []).map((p) => p.id));
          const hasValidAssignment = (assignments ?? []).some(
            (a) => activeProviderIds.has(a.provider_id) && activeServiceIds.has(a.service_id)
          );
          hasAssignment = hasValidAssignment;
          assignmentStatus = hasValidAssignment ? 'ok' : 'missing';
        } else {
          // No assignments configured — fallback mode (all providers can do all services)
          hasAssignment = true;
          assignmentStatus = 'not_used';
        }
      }
      // If table doesn't exist, fallback mode
    }

    const checks = {
      profile: profileComplete,
      providers: hasProvider,
      services: hasService,
      schedule: hasSchedule,
      assignment: hasAssignment,
    };

    const missing: string[] = [];
    if (!profileComplete) missing.push('Complete your clinic profile (name, phone, address)');
    if (!hasProvider) missing.push('Add at least one active provider');
    if (!hasService) missing.push('Add at least one active service');
    if (!hasSchedule) missing.push('Configure working hours for at least one provider');
    if (!hasAssignment) missing.push('Assign at least one service to an active provider');

    const ready = Object.values(checks).every(Boolean);

    return NextResponse.json({
      data: {
        status: ready ? 'ready' : 'incomplete',
        ready,
        checks,
        assignmentStatus,
        missing,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('clinic_setup_status_error', { error: message }, 'error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}