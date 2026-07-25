import { NextRequest, NextResponse } from 'next/server';
import { getLeads, createLead } from '@/lib/services/leads';
import { getSupabaseEnvConfig } from '@/lib/config';

let demoLeads = [
  {
    id: 1,
    name: 'منى خالد',
    email: 'mona@example.com',
    phone: '+966500000001',
    source: 'موقع الويب',
    status: 'جديد',
  },
  {
    id: 2,
    name: 'خالد سعيد',
    email: 'khaled@example.com',
    phone: '+966500000002',
    source: 'الهاتف',
    status: 'قيد المتابعة',
  },
];
let nextLeadId = demoLeads.length + 1;

export async function GET() {
  const config = getSupabaseEnvConfig();

  if (!config.isConfigured) {
    return NextResponse.json(demoLeads);
  }

  try {
    const data = await getLeads();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const config = getSupabaseEnvConfig();

  if (!config.isConfigured) {
    const nextLead = { id: nextLeadId++, ...body };
    demoLeads = [nextLead, ...demoLeads];
    return NextResponse.json(nextLead);
  }

  try {
    const lead = await createLead(body);
    return NextResponse.json(lead);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}
