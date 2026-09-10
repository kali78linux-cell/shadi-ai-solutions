import { NextResponse } from 'next/server';
import { authorizeClinicRequest, roleDenied, FINANCE_READ_ROLES } from '@/lib/services/clinicAuthorization';
import { getFinancialIntelligence } from '@/lib/services/financialIntelligence';

/**
 * PP-5 — Financial Intelligence (clinic-facing, read-only, FINANCE_READ).
 * GET /api/clinic/financial-intelligence?clinic_id=…&from_month=YYYY-MM-01&to_month=YYYY-MM-01
 *
 * All outputs are DERIVED at read time from the existing financial views
 * (financial_period_summary / cash_flow_summary / receivable_aging /
 * daily_cash_positions). No writes, no ledger changes, no new financial source.
 * clinic_id is always the authorized tenant (never client-derived scope).
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const clinicId = url.searchParams.get('clinic_id');
    if (!clinicId) return NextResponse.json({ error: 'clinic_id required' }, { status: 400 });

    const authorization = await authorizeClinicRequest(req, clinicId);
    const denied = roleDenied(authorization, FINANCE_READ_ROLES);
    if (denied) {
      return NextResponse.json(
        { error: denied.status === 401 ? 'Unauthorized' : 'Forbidden' },
        { status: denied.status }
      );
    }

    const data = await getFinancialIntelligence(clinicId, {
      fromMonth: url.searchParams.get('from_month') ?? undefined,
      toMonth: url.searchParams.get('to_month') ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /^INVALID_/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}