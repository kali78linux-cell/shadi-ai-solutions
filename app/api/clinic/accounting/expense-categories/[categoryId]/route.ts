import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, EXPENSE_CATEGORY_MANAGE_ROLES } from '@/lib/services/clinicAuthorization';
import { updateExpenseCategory } from '@/lib/services/accounting';

// Accounting Phase C — update an expense category (rename / activate-deactivate).
// Categories are never deleted; deactivation preserves full history.
export async function PATCH(req: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  try {
    const { categoryId } = await params;
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });
    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, EXPENSE_CATEGORY_MANAGE_ROLES);
    if (denied) return NextResponse.json({ error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: denied.status });
    const body = await req.json();
    const data = await updateExpenseCategory({
      clinicId,
      categoryId,
      name: body?.name ?? null,
      isActive: body?.is_active ?? null,
      actorUserId: authorization.user?.id ?? null,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /CATEGORY_NAME_REQUIRED/.test(message)
      ? 400
      : /row-level security|no rows|0 rows/i.test(message)
        ? 404
        : /duplicate key|unique constraint/i.test(message)
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
