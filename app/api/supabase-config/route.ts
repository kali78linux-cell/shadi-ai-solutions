import { NextResponse } from 'next/server';
import { getSupabaseEnvConfig } from '@/lib/config';

export async function GET() {
  const config = getSupabaseEnvConfig();

  return NextResponse.json({
    supabaseUrl: config.supabaseUrl,
    anonKeyExists: Boolean(config.anonKey),
    serviceRoleKeyExists: Boolean(config.serviceRoleKey),
    isConfigured: config.isConfigured,
  });
}
