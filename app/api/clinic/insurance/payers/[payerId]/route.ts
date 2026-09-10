import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES } from '@/lib/services/clinicAuthorization';
import { updatePayer } from '@/lib/services/insurance';

// Payer update / deactivate (never delete — DB guard enforces immutability).
export async function PATCH(req: Request, { params }: { params: Promise<{ payerId: string }> }) {
  try {
    const { payerId } = await params;
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await updatePayer({
      clinicId: body.clinic_id,
      payerId,
      name: body.name,
      contactName: body.contact_name,
      contactPhone: body.contact_phone,
      isActive: body.is_active,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /PAYER_NAME_REQUIRED/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
