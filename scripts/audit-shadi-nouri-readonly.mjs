// Read-only audit of the target clinic (Shadi Nouri). NEVER inserts/updates/deletes.
// Reads .env.local for credentials (same pattern as supabase-schema-check.mjs).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || url.includes('example') || url.includes('placeholder')) {
  console.log('AUDIT: BLOCKED - real Supabase URL missing');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let clinic = null;
const { data: found, error: findErr } = await admin
  .from('clinics')
  .select('*')
  .or(`name.ilike.%shadi%,name.ilike.%nouri%,name.ilike.%shadi%`)
  .limit(10);
if (findErr) {
  console.log('Find clinic error:', findErr.message);
  process.exit(1);
}
if (found && found.length === 0) {
  // Fallback: list all clinics by name so we can locate the target.
  const { data: all, error: allErr } = await admin.from('clinics').select('id,name,created_at').limit(50);
  if (allErr) console.log('List clinics error:', allErr.message);
  else console.log('Clinics in DB:', JSON.stringify(all, null, 2));
  process.exit(0);
}
clinic = found[0];
console.log('TARGET CLINIC:', JSON.stringify({ id: clinic.id, name: clinic.name }, null, 2));
const cid = clinic.id;

const tables = {
  clinic_users: ['id', 'user_id', 'role'],
  clinic_services: ['id', 'name', 'active'],
  providers: ['id', 'name', 'title', 'active'],
  provider_services: ['id', 'provider_id', 'service_id'],
  provider_schedules: ['id', 'provider_id', 'day_of_week', 'start_time', 'end_time', 'is_working_day', 'break_start', 'break_end'],
  provider_breaks: ['id', 'provider_id'],
  clinic_holidays: ['id', 'date', 'name'],
  clinic_ai_settings: ['id', 'ai_provider', 'model', 'temperature'],
  clinic_ai_components: ['id', 'component', 'enabled'],
  clinic_knowledge_documents: ['id', 'original_filename', 'processing_status', 'chunk_count'],
  clinic_ai_knowledge: ['id', 'document_id', 'chunk_index'],
  clinic_communication_settings: ['clinic_id'],
  clinic_notification_templates: ['id', 'name'],
};
const known = Object.keys(tables);
async function queryTable(t) {
  try {
    const { data, error } = await admin.from(t).select('*').eq('clinic_id', cid).limit(200);
    if (error) {
      const d2 = await admin.from(t).select('id').eq('clinic_id', cid);
      if (d2.error) return { label: `${t}: ERR ${d2.error.message}` };
      return { label: `${t}: ${Array.isArray(d2.data) ? d2.data.length : '?'} rows (shape)` };
    }
    return { label: `${t}: ${Array.isArray(data) ? data.length : '?'} rows`, rows: data };
  } catch (e) {
    return { label: `${t}: THROW ${e.message}` };
  }
}
for (const t of known) {
  const r = await queryTable(t);
  console.log('  ' + r.label);
  if (Array.isArray(r.rows) && r.rows.length) console.log('    sample:', JSON.stringify(r.rows[0], null, 2));
}
console.log('READONLY AUDIT COMPLETE');
process.exit(0);
console.log('READONLY AUDIT COMPLETE');
process.exit(0);