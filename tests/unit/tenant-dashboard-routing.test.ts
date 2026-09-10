import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_MODULES,
  isSafeDashboardPath,
  ownerLoginUrl,
  tenantDashboardUrl,
} from '@/lib/services/dashboardPaths';
import fs from 'node:fs';
import path from 'node:path';

describe('tenant dashboard routing — isSafeDashboardPath (open-redirect guard)', () => {
  it('accepts the canonical tenant paths', () => {
    expect(isSafeDashboardPath('/dashboard/ai-clinic/overview')).toBe(true);
    expect(isSafeDashboardPath('/dashboard/shadi-nouri/appointments')).toBe(true);
    expect(isSafeDashboardPath('/dashboard/tenants')).toBe(true);
    expect(isSafeDashboardPath('/dashboard/ai-clinic/providers')).toBe(true);
    expect(isSafeDashboardPath('/dashboard/ai-clinic/conversations/abc123')).toBe(true);
  });

  it('accepts /dashboard index and flat module paths (safe-shaped)', () => {
    expect(isSafeDashboardPath('/dashboard')).toBe(true);
    expect(isSafeDashboardPath('/dashboard/overview')).toBe(true);
    // Fail-closed: URLs with query strings are rejected (conservative).
    expect(isSafeDashboardPath('/dashboard/subscription?x=1')).toBe(false);
  });

  it('rejects absolute / external / traversal / query-only values', () => {
    expect(isSafeDashboardPath('https://evil.example')).toBe(false);
    expect(isSafeDashboardPath('//evil.example')).toBe(false);
    expect(isSafeDashboardPath('/dashboard/x/../y')).toBe(false);
    expect(isSafeDashboardPath('/dashboard/ai-clinic/..')).toBe(false);
    expect(isSafeDashboardPath('bad/dashboard/x')).toBe(false);
    expect(isSafeDashboardPath('')).toBe(false);
    expect(isSafeDashboardPath(null)).toBe(false);
    expect(isSafeDashboardPath('/other/path')).toBe(false);
    expect(isSafeDashboardPath('/dashboard/ai-clinic/overview/../../secret')).toBe(false);
  });

  it('rejects dangerous protocol / colon / backslash tricks', () => {
    expect(isSafeDashboardPath('javascript:alert(1)')).toBe(false);
    expect(isSafeDashboardPath('http://localhost:3000/dashboard/x')).toBe(false);
    expect(isSafeDashboardPath('/dashboard\\x')).toBe(false);
    expect(isSafeDashboardPath('/dashboard/ai-clinic\\secret')).toBe(false);
  });
});

describe('tenant dashboard routing — URL builders', () => {
  it('builds canonical tenant URLs', () => {
    expect(tenantDashboardUrl('ai-clinic', 'overview')).toBe('/dashboard/ai-clinic/overview');
    expect(tenantDashboardUrl('shadi-nouri', 'providers')).toBe('/dashboard/shadi-nouri/providers');
  });

  it('builds the public-space owner login entry', () => {
    expect(ownerLoginUrl('ai-clinic')).toBe(
      '/login?next=%2Fdashboard%2Fai-clinic%2Foverview'
    );
    expect(ownerLoginUrl('shadi-nouri')).toBe(
      '/login?next=%2Fdashboard%2Fshadi-nouri%2Foverview'
    );
  });

  it('has a deterministic module list matching the file system', () => {
    const tenantDir = path.join(process.cwd(), 'app/(dashboard)/dashboard/[clinicSlug]');
    const legacyDir = path.join(process.cwd(), 'app/(dashboard)/dashboard');
    const dirs = fs.readdirSync(tenantDir, { withFileTypes: true });

    for (const module of DASHBOARD_MODULES) {
      // canonical tenant module page exists
      expect(fs.existsSync(path.join(tenantDir, module, 'page.tsx')), `[clinicSlug]/${module}`).toBe(true);
      // legacy compat redirect stub exists (no dead links)
      expect(fs.existsSync(path.join(legacyDir, module, 'page.tsx')), `legacy ${module}`).toBe(true);
      // no directory exists without registration
      const real = dirs.filter((d) => d.isDirectory() && fs.existsSync(path.join(tenantDir, d.name, 'page.tsx')));
      const registered = new Set(DASHBOARD_MODULES as readonly string[]);
      for (const d of real) {
        expect(registered.has(d.name), `registered: ${d.name}`).toBe(true);
      }
    }
  });
});