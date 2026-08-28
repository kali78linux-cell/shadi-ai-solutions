import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent, sanitizeLogPayload } from '@/lib/server/logging';

/**
 * Central audit trail writer. Server-side only (service-role client bypasses
 * RLS; clients have no insert policy on audit_logs so actor_user_id cannot be
 * forged). Metadata is sanitized (sensitive keys stripped, values truncated)
 * and must never contain secrets.
 */
export async function writeAuditLog(params: {
  clinicId: string;
  actorUserId: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const safeMetadata = (sanitizeLogPayload(params.metadata ?? {}) ?? {}) as Record<string, unknown>;
    await supabaseAdmin.from('audit_logs').insert({
      clinic_id: params.clinicId,
      actor_user_id: params.actorUserId,
      action: params.action,
      resource_type: params.resourceType ?? '',
      resource_id: params.resourceId ?? '',
      metadata: safeMetadata,
    });
    logEvent('audit', { clinic_id: params.clinicId, action: params.action });
  } catch (err) {
    // Audit failures must never break the primary operation.
    logEvent('audit_write_error', { action: params.action, error: err instanceof Error ? err.message : String(err) }, 'error');
  }
}