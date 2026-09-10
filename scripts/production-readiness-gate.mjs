#!/usr/bin/env node
/**
 * PHASE 8 — Production Readiness Gate (automated).
 *
 * Aggregates ALREADY-EXISTING evidence into one PASS/FAIL/BLOCKED report.
 * READ-ONLY against production DB (SELECT/information_schema only).
 * No migrations. No data changes. No Stripe operations.
 *
 * Usage: node scripts/production-readiness-gate.mjs [--skip-tests] [--skip-build]
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  evaluateCodeGates,
  evaluateExternalGates,
  evaluateOverall,
  stepFromExit,
  makeStep,
  EXTERNAL_GATE_IDS,
} from './lib/readiness-core.mjs';

const args = new Set(process.argv.slice(2));
const root = process.cwd();

function sh(cmd, timeoutMs = 600_000) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    return { exit: 0, out: (out ?? '').slice(-4000) };
  } catch (e) {
    return { exit: e.status ?? 1, out: ((e.stdout ?? '') + (e.stderr ?? '')).slice(-4000) };
  }
}

function readEnvLocal() {
  const p = path.join(root, '.env.local');
  if (!fs.existsSync(p)) return {};
  const env = {};
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const steps = [];

// ─── Step 1: typescript ───────────────────────────────────────────────────────
console.log('[1/6] typescript — npx tsc --noEmit');
const tsc = sh('npx tsc --noEmit', 300_000);
steps.push(stepFromExit('typescript', tsc.exit, tsc.exit === 0 ? '0 errors' : tsc.out));

// ─── Step 2: full test suite ──────────────────────────────────────────────────
if (!args.has('--skip-tests')) {
  console.log('[2/6] tests — npx vitest run (full suite)');
  const tests = sh('npx vitest run', 900_000);
  const m = tests.out.match(/Tests\s+\d+ passed/);
  steps.push(stepFromExit('tests', tests.exit, m ? m[0] : tests.out));
} else {
  steps.push(makeStep('tests', 'blocked', 'skipped via --skip-tests'));
}

// ─── Step 3: build ────────────────────────────────────────────────────────────
if (!args.has('--skip-build')) {
  console.log('[3/6] build — npm run build');
  const build = sh('npm run build', 900_000);
  steps.push(stepFromExit('build', build.exit, /Compiled successfully/.test(build.out) ? 'Compiled successfully' : build.out));
} else {
  steps.push(makeStep('build', 'blocked', 'skipped via --skip-build'));
}

// ─── Step 4: migrations order (database-audit contract) ──────────────────────
console.log('[4/6] migrations order');
const migDir = path.join(root, 'db', 'migrations');
const migFiles = fs.existsSync(migDir) ? fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')) : [];
const sorted = [...migFiles].sort();
const orderedOk = JSON.stringify(migFiles) === JSON.stringify(sorted) && migFiles.length > 0;
steps.push(
  orderedOk
    ? makeStep('migrations_order', 'pass', `${migFiles.length} migrations, filename-date ordered`)
    : makeStep('migrations_order', 'fail', 'db/migrations empty or not filename-date ordered')
);

// ─── Step 5: live DB RLS probes (READ-ONLY) ───────────────────────────────────
console.log('[5/6] database_rls — live probes (read-only)');
const env = readEnvLocal();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN || '';

async function runQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${url.replace('https://', '').split('.')[0]}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}

if (!url || !token) {
  steps.push(makeStep('database_rls', 'blocked', 'SUPABASE_ACCESS_TOKEN unavailable — run with token to probe live RLS'));
} else {
  try {
    const critical = ['patients', 'appointments', 'clinic_invoices', 'intake_responses', 'recall_assignments', 'notification_queue'];
    const checks = critical.map(
      (t) => `select '${t}' as tbl, (select count(*)::int from pg_class where relname='${t}' and relrowsecurity) as rls`
    );
    const rows = await runQuery(checks.join(' union all '));
    const bad = rows.filter((r) => r.rls !== 1);
    steps.push(
      bad.length === 0
        ? makeStep('database_rls', 'pass', `RLS enabled on all ${critical.length} critical tables`)
        : makeStep('database_rls', 'fail', `RLS missing on: ${bad.map((r) => r.tbl).join(', ')}`)
    );
  } catch (e) {
    steps.push(makeStep('database_rls', 'blocked', `probe failed: ${e.message}`));
  }
}

// ─── Step 6: targeted security suites ─────────────────────────────────────────
console.log('[6/6] targeted_security — RBAC/audit/webhook/entitlement/workflow suites');
const suites = [
  'tests/unit/rbac.test.ts',
  'tests/unit/audit-members.test.ts',
  'tests/unit/reliability-recovery.test.ts',
  'tests/unit/webhook-verifier.test.ts',
  'tests/unit/entitlement-gates.test.ts',
  'tests/unit/workflow-api.test.ts',
  'tests/unit/phase2-apis.test.ts',
  'tests/unit/phase3-4-apis.test.ts',
].filter((f) => fs.existsSync(path.join(root, f)));
const sec = sh(`npx vitest run ${suites.join(' ')}`, 600_000);
steps.push(stepFromExit('targeted_security', sec.exit, sec.out.match(/Tests\s+\d+ passed/)?.[0] ?? sec.out));

// ─── External gates ───────────────────────────────────────────────────────────
const gatesPath = path.join(root, 'docs', 'external-gates.json');
let external = {};
try {
  external = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
} catch {
  console.error('WARN: docs/external-gates.json unreadable — all external gates treated OPEN');
}

// ─── Verdict + report ─────────────────────────────────────────────────────────
const code = evaluateCodeGates(steps);
const ext = evaluateExternalGates(external);
const overall = evaluateOverall(steps, external);

console.log('\n===== PRODUCTION READINESS GATE =====');
for (const s of steps) console.log(`  [${s.status.toUpperCase().padEnd(7)}] ${s.id} — ${s.evidence.split('\n')[0]}`);
for (const id of EXTERNAL_GATE_IDS) console.log(`  [EXTERNAL ${ext.statuses[id].toUpperCase()}] ${id}`);
console.log(`CODE GATES : ${code.verdict} (${code.reason})`);
console.log(`EXTERNAL   : ${ext.verdict} (${ext.closedCount}/${EXTERNAL_GATE_IDS.length} closed)`);
console.log(`OVERALL    : ${overall.overall}`);

const report = {
  generated_at: new Date().toISOString(),
  steps,
  external: ext.statuses,
  code: code.verdict,
  overall: overall.overall,
  reason: overall.reason,
};
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'production-readiness-report.json'), JSON.stringify(report, null, 2));
console.log('Report written: docs/production-readiness-report.json');

process.exit(overall.overall.startsWith('PASS') ? 0 : overall.overall === 'BLOCKED' ? 2 : 1);