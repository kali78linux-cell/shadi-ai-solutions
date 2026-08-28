import { describe, it, expect } from 'vitest';
import { roleDenied, ADMIN_ROLES, CLINIC_ROLES } from '@/lib/services/clinicAuthorization';

/**
 * RBAC matrix tests. These verify the central role gate that all sensitive
 * clinic APIs use. UI hiding is convenience only; this is the real boundary
 * together with RLS.
 */

function auth(role: string | null) {
  return { authorized: true, status: 200, role };
}

describe('RBAC role gate (roleDenied)', () => {
  it('allows owner and manager for admin operations', () => {
    expect(roleDenied(auth('owner'), ADMIN_ROLES)).toBeNull();
    expect(roleDenied(auth('manager'), ADMIN_ROLES)).toBeNull();
  });

  it.each(['doctor', 'receptionist', 'staff', 'accountant'])('denies %s for admin operations with 403', (role) => {
    const denied = roleDenied(auth(role), ADMIN_ROLES);
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });

  it('denies missing role even if authenticated', () => {
    expect(roleDenied(auth(null), ADMIN_ROLES)?.status).toBe(403);
  });

  it('denies unauthenticated regardless of roles', () => {
    const denied = roleDenied({ authorized: false, status: 401 }, ADMIN_ROLES);
    expect(denied?.status).toBe(401);
  });

  it('every recognized clinic role passes a gate of all roles', () => {
    for (const r of CLINIC_ROLES) {
      expect(roleDenied(auth(r), CLINIC_ROLES)).toBeNull();
    }
  });

  it('never lets a non-owner satisfy an owner-only gate (privilege escalation guard)', () => {
    const OWNER_ONLY = ['owner'] as const;
    for (const r of ['manager', 'doctor', 'receptionist', 'accountant', 'staff', null]) {
      expect(roleDenied(auth(r), OWNER_ONLY)?.status).toBe(403);
    }
    expect(roleDenied(auth('owner'), OWNER_ONLY)).toBeNull();
  });
});

