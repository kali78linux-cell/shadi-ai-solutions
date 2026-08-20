import fs from 'fs';

// Read .env.local safely
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || get('SUPABASE_ACCESS_TOKEN');

if (!url || url.includes('your-') || url.includes('placeholder')) {
  console.log('APPLY: BLOCKED — real URL missing');
  process.exit(1);
}
if (!accessToken) {
  console.log('APPLY: BLOCKED — SUPABASE_ACCESS_TOKEN missing');
  process.exit(1);
}

const ref = url.replace('https://', '').split('.')[0];
console.log(`Project ref: ${ref}`);

const migrations = [
  'db/migrations/20260726_vector_search.sql',
  'db/migrations/20260727_usage_tracking_enhancements.sql',
  'db/migrations/20260729_schema_reconciliation.sql',
   'db/migrations/20260809_booking_service_catalog.sql',
   'db/migrations/20260810_booking_confirmation_tokens.sql',
   'db/migrations/20260812_clinic_communication_settings.sql',
  'db/migrations/20260813_provider_schedule_assignment.sql',
  'db/migrations/20260815_notification_templates_and_reminder_config.sql',
  'db/migrations/20260816_fix_recursive_rls.sql',
];

const apiBase = 'https://api.supabase.com/v1/projects';

for (const file of migrations) {
  const sql = fs.readFileSync(file, 'utf8');
  console.log(`\n=== Applying ${file} ===`);
  try {
    const res = await fetch(`${apiBase}/${ref}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`FAILED (${res.status}): ${text.slice(0, 800)}`);
      process.exit(1);
    }
    console.log(`OK (${res.status})`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

console.log('\n=== ALL MIGRATIONS APPLIED ===');