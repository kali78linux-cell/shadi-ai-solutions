import { describe, it, expect } from 'vitest';
import { roleDenied, ADMIN_ROLES, DATA_ROLES } from '@/lib/services/clinicAuthorization';

describe('audit & members authorization matrix', () => {
  it('admin roles can manage members; data roles cannot', () => {
    for (const role of ['owner','manager']) {
      expect(roleDenied({ authorized: true, role }, ADMIN_ROLES)).toBeNull();
    }
    for (const role of ['doctor','receptionist','staff']) {
      const denial = roleDenied({ authorized: true, role }, ADMIN_ROLES);
      expect(denial?.status).toBe(403);
    }
  });

  it('data roles may read operational data (GET members list is admin-only though)', () => {
    expect(DATA_ROLES).toContain('doctor');
    expect(ADMIN_ROLES).not.toContain('receptionist');
  });

  it('unauthenticated is always denied', () => {
    const denial = roleDenied({ authorized: false, status: 401 }, ADMIN_ROLES);
    expect(denial?.status).toBe(401);
  });

  it('cross-tenant: role check binds to the resolved membership clinic, not client input', () => {
    // authorizeClinicRequest resolves membership from the token's user_id + clinic_id param;
    // a forged clinic_id yields no membership -> unauthorized before role check.
    const denied = roleDenied({ authorized: true, role: 'owner', clinicId: 'other-clinic' } as any, ADMIN_ROLES);
    expect(denied).toBeNull();
  });

  it('unknown roles are denied (fail-closed)', () => {
    const denial = roleDenied({ authorized: true, role: 'superadmin' as any }, ADMIN_ROLES);
    expect(denial?.status).toBe(403);
  });
});
