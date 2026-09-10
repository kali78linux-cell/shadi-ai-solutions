import { describe, expect, it } from 'vitest';
import { getActivityNavigation } from '@/components/dashboard/DashboardNav';
import { NAV_GROUPS, groupForModule, groupNavLinks } from '@/lib/services/dashboardNavModel';

const GROUP_IDS = NAV_GROUPS.map((g) => g.id);

describe('PHASE K — dashboard sidebar groups', () => {
  it('every module of every activity maps to a defined group', () => {
    for (const activity of ['clinic', 'imaging_center', 'dental_lab', null] as const) {
      for (const link of getActivityNavigation(activity)) {
        expect(GROUP_IDS, `${activity}/${link.module}`).toContain(groupForModule(link.module));
      }
    }
  });

  it('canonical group placement', () => {
    expect(groupForModule('overview')).toBe('ops');
    expect(groupForModule('imaging-requests')).toBe('ops');
    expect(groupForModule('messages')).toBe('communication');
    expect(groupForModule('referring-clinics')).toBe('communication');
    expect(groupForModule('financial-intelligence')).toBe('finance');
    expect(groupForModule('subscription')).toBe('finance');
    expect(groupForModule('profile')).toBe('settings');
  });

  it('groupNavLinks buckets preserve the exact module multiset (no loss, no dup)', () => {
    for (const activity of ['clinic', 'imaging_center', 'dental_lab'] as const) {
      const links = getActivityNavigation(activity);
      const grouped = groupNavLinks(links).flatMap((g) => g.items);
      const a = grouped.map((l) => [l.module, l.label] as const).sort((x, y) => x[0].localeCompare(y[0]));
      const b = links.map((l) => [l.module, l.label] as const).sort((x, y) => x[0].localeCompare(y[0]));
      expect(a).toEqual(b);
    }
  });

  it('PHASE K6 — profile module exists for every activity', () => {
    for (const activity of ['clinic', 'imaging_center', 'dental_lab'] as const) {
      expect(getActivityNavigation(activity).map((l) => l.module)).toContain('profile');
    }
  });

  it('unknown module falls back to ops (never silently vanishes)', () => {
    expect(groupForModule('brand-new-module')).toBe('ops');
  });
});
