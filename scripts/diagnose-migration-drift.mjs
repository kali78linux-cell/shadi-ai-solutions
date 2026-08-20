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
  console.log('DIAGNOSE: BLOCKED — real URL missing');
  process.exit(1);
}

console.log('=== REMOTE OBJECT DIAGNOSIS (read-only) ===\n');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// Helper: check if a table exists and list its columns via PostgREST
async function tableExists(table) {
  try {
    const { data, error } = await admin.from(table).select('*').limit(1);
    if (error) return { exists: false, error: error.message };
    return { exists: true, sample: data };
  } catch (e) {
    return { exists: false, error: e.message };
  }
}

// Helper: check if a column exists by attempting a select on it
async function columnExists(table, column) {
  try {
    const { data, error } = await admin.from(table).select(column).limit(1);
    if (error) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// Migration 20260723000001_communication_gateway.sql
// Creates: gateway_channels, gateway_messages, gateway_dlq
// ============================================================
console.log('--- 20260723000001_communication_gateway.sql ---');
for (const t of ['gateway_channels', 'gateway_messages', 'gateway_dlq']) {
  const r = await tableExists(t);
  console.log(`  ${t}: ${r.exists ? 'EXISTS' : 'MISSING'}${r.error ? ' (' + r.error + ')' : ''}`);
}

// ============================================================
// Migration 20260726_vector_search.sql
// Adds: clinic_ai_knowledge.embedding_vector, match_clinic_documents fn
// ============================================================
console.log('\n--- 20260726_vector_search.sql ---');
console.log(`  clinic_ai_knowledge.embedding_vector: ${await columnExists('clinic_ai_knowledge', 'embedding_vector') ? 'EXISTS' : 'MISSING'}`);

// ============================================================
// Migration 20260727_usage_tracking_enhancements.sql
// Adds: ai_usage.prompt_tokens/completion_tokens, messages.prompt_tokens/completion_tokens
// ============================================================
console.log('\n--- 20260727_usage_tracking_enhancements.sql ---');
console.log(`  ai_usage.prompt_tokens: ${await columnExists('ai_usage', 'prompt_tokens') ? 'EXISTS' : 'MISSING'}`);
console.log(`  ai_usage.completion_tokens: ${await columnExists('ai_usage', 'completion_tokens') ? 'EXISTS' : 'MISSING'}`);
console.log(`  messages.prompt_tokens: ${await columnExists('messages', 'prompt_tokens') ? 'EXISTS' : 'MISSING'}`);

// ============================================================
// Migration 20260728_conversation_intelligence.sql
// Adds: conversations.conversation_state, ai_leads.lead_temperature
// ============================================================
console.log('\n--- 20260728_conversation_intelligence.sql ---');
console.log(`  conversations.conversation_state: ${await columnExists('conversations', 'conversation_state') ? 'EXISTS' : 'MISSING'}`);
console.log(`  ai_leads.lead_temperature: ${await columnExists('ai_leads', 'lead_temperature') ? 'EXISTS' : 'MISSING'}`);

// ============================================================
// Migration 20260729_schema_reconciliation.sql
// Creates: profiles, clinic_knowledge_documents; renames patients.name->full_name
// ============================================================
console.log('\n--- 20260729_schema_reconciliation.sql ---');
for (const t of ['profiles', 'clinic_knowledge_documents']) {
  const r = await tableExists(t);
  console.log(`  ${t}: ${r.exists ? 'EXISTS' : 'MISSING'}${r.error ? ' (' + r.error + ')' : ''}`);
}
console.log(`  patients.full_name: ${await columnExists('patients', 'full_name') ? 'EXISTS' : 'MISSING'}`);
console.log(`  patients.phone_number: ${await columnExists('patients', 'phone_number') ? 'EXISTS' : 'MISSING'}`);

// ============================================================
// Migration 20260813_provider_schedule_assignment.sql
// Creates: provider_services
// ============================================================
console.log('\n--- 20260813_provider_schedule_assignment.sql ---');
const ps = await tableExists('provider_services');
console.log(`  provider_services: ${ps.exists ? 'EXISTS' : 'MISSING'}${ps.error ? ' (' + ps.error + ')' : ''}`);

// ============================================================
// Migration 20260816_fix_recursive_rls.sql
// Creates: app_user_is_active_clinic_member_safe (SECURITY DEFINER)
// ============================================================
console.log('\n--- 20260816_fix_recursive_rls.sql ---');
try {
  const { data, error } = await admin.rpc('app_user_is_active_clinic_member_safe', { clinic: '00000000-0000-0000-0000-000000000000' });
  console.log(`  app_user_is_active_clinic_member_safe: ${error ? 'MISSING (' + error.message + ')' : 'EXISTS (returns ' + data + ')'}`);
} catch (e) {
  console.log(`  app_user_is_active_clinic_member_safe: MISSING (${e.message})`);
}

// ============================================================
// Also check the newer tables that schema-check flagged missing
// ============================================================
console.log('\n--- Other phase tables ---');
for (const t of ['clinic_services', 'clinic_communication_settings', 'clinic_notification_templates']) {
  const r = await tableExists(t);
  console.log(`  ${t}: ${r.exists ? 'EXISTS' : 'MISSING'}${r.error ? ' (' + r.error + ')' : ''}`);
}

console.log('\n=== DIAGNOSIS COMPLETE ===');