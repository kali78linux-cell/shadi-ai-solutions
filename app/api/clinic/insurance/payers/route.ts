import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_ADMIN_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { listPayers, createPayer, type PayerType } from '@/lib/services/insurance';

// Insurance Foundation — payer directory (D-I4: FINANCE gates; DATA_ROLES
// untouched). Payers are never deleted (deactivate only; DB guard enforces).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, FINANCE_ADMIN_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await createPayer({
      clinicId: body.clinic_id,
      name: body.name ?? '',
      payerType: (body.payer_type ?? 'insurance') as PayerType,
      contactName: body.contact_name ?? null,
      contactPhone: body.contact_phone ?? null,
      notes: body.notes ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /PAYER_NAME_REQUIRED/.test(message)
      ? 400
      : /invalid input value/.test(message)
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const data = await listPayers(clinicId, url.searchParams.get('include_inactive') === 'true');
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
