import { supabaseAdmin } from '@/lib/supabase/admin';
import { issueInvoice } from '@/lib/services/accounting';
import { logEvent } from '@/lib/server/logging';

/**
 * IMAGING → BILLING (single source of truth for the completed-imaging charge).
 *
 * Invariants:
 *  - Only a COMPLETED imaging request with a billable service_id (and a
 *    visible price in clinic_services) issues an invoice.
 *  - Idempotent: the invoice notes carry `imaging_request:<id>` — repeated
 *    completions/replays never double-bill.
 *  - No service_id / no patient / no price → no financial event.
 */
const MARKER_PREFIX = 'imaging_request:';

export async function issueInvoiceForImagingRequest(input: {
  clinicId: string;
  requestId: string;
  actorUserId: string | null;
}): Promise<{ issued: boolean; invoiceId?: string; invoiceNumber?: string; reason?: string }> {
  const marker = `${MARKER_PREFIX}${input.requestId}`;

  const { data: request } = await supabaseAdmin
    .from('imaging_requests')
    .select('id, clinic_id, patient_id, service_id, requested_service, referring_provider_id, appointment_id, status')
    .eq('id', input.requestId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!request || request.clinic_id !== input.clinicId) return { issued: false, reason: 'request_not_found' };
  if (!request.patient_id || !request.service_id) return { issued: false, reason: 'nothing_billable' };

  // Idempotency gate: an invoice with this marker already exists → skip.
  const { data: existing } = await supabaseAdmin
    .from('clinic_invoices')
    .select('id, invoice_number')
    .eq('clinic_id', input.clinicId)
    .ilike('notes', `%${marker}%`)
    .is('voided_at', null)
    .maybeSingle();
  if (existing) {
    logEvent('imaging_invoice_already_issued', { request_id: input.requestId, invoice_id: existing.id });
    return { issued: false, invoiceId: existing.id, invoiceNumber: existing.invoice_number, reason: 'already_issued' };
  }

  const { data: service } = await supabaseAdmin
    .from('clinic_services')
    .select('id, name, pricing_type, price, price_min, price_visible_to_patients')
    .eq('id', request.service_id)
    .eq('clinic_id', input.clinicId)
    .eq('active', true)
    .is('deleted_at', null)
    .maybeSingle();
  if (!service) return { issued: false, reason: 'service_not_found' };

  if (service.price_visible_to_patients === false) return { issued: false, reason: 'price_hidden' };
  const price =
    service.price != null && Number(service.price) > 0
      ? Number(service.price)
      : service.price_min != null && Number(service.price_min) > 0
        ? Number(service.price_min)
        : null;
  if (price == null || price <= 0) {
    logEvent('imaging_invoice_skipped_no_price', { request_id: input.requestId, service_id: request.service_id });
    return { issued: false, reason: 'no_price' };
  }

  const invoice = await issueInvoice({
    clinicId: input.clinicId,
    patientId: request.patient_id,
    appointmentId: request.appointment_id ?? null,
    actorUserId: input.actorUserId,
    items: [
      {
        service_id: request.service_id,
        provider_id: request.referring_provider_id ?? null,
        description: `${request.requested_service ?? service.name} — تصوير مكتمل`,
        quantity: 1,
        unit_price: price,
      },
    ],
    notes: `إيراد تصوير مكتمل · ${marker}`,
  });

  await supabaseAdmin.from('imaging_requests').update({ imaging_status: 'performed' }).eq('id', input.requestId);

  logEvent('imaging_invoice_issued', {
    clinic_id: input.clinicId,
    request_id: input.requestId,
    invoice_id: invoice.invoiceId,
    invoice_number: invoice.invoiceNumber,
    amount: price,
  });
  return { issued: true, invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber };
}