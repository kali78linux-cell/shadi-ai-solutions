import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Read .env.local safely, never printing values
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');

if (!url || url.includes('your-') || url.includes('placeholder')) {
  console.log('SCHEMA CHECK: BLOCKED — real URL missing');
  process.exit(1);
}

console.log('Checking real database schema state via service-role key...');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Tables that should exist after all migrations
const expectedTables = [
  'clinics', 'clinic_users', 'patients', 'providers', 'appointments',
  'conversations', 'messages', 'knowledge_base', 'leads', 'subscriptions',
  'notifications', 'audit_logs', 'provider_schedules', 'provider_vacations',
  'clinic_holidays', 'notification_queue', 'clinic_services', 'clinic_communication_settings',
  'provider_services', 'clinic_notification_templates',
];

for (const table of expectedTables) {
  try {
    const { data, error } = await admin.from(table).select('id').limit(1);
    if (error) {
      console.log(`  ${table}: MISSING — ${error.message}`);
    } else {
      console.log(`  ${table}: EXISTS (${Array.isArray(data) ? data.length : '?'} row(s) visible)`);
    }
  } catch (e) {
    console.log(`  ${table}: ERROR — ${e.message}`);
  }
}

console.log('SCHEMA CHECK COMPLETE');