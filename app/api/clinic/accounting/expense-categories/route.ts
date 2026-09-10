import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, EXPENSE_CATEGORY_MANAGE_ROLES, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { listExpenseCategories, createExpenseCategory } from '@/lib/services/accounting';

// Accounting Phase C — expense categories (per-clinic config).
// POST = create, GET = list. Categories are never deleted (deactivate only).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.clinic_id) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, body.clinic_id);
    const denied = roleDenied(authorization, EXPENSE_CATEGORY_MANAGE_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });

    const data = await createExpenseCategory({
      clinicId: body.clinic_id,
      name: body.name ?? '',
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /CATEGORY_NAME_REQUIRED/.test(message)
      ? 400
      : /duplicate key|unique constraint/i.test(message)
        ? 409
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
    const data = await listExpenseCategories(clinicId);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
