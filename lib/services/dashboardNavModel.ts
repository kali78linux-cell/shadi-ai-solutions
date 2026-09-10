/**
 * PHASE K — Dashboard navigation grouping model.
 *
 * Pure data + pure functions (no React) so unit tests can verify grouping
 * without rendering. DashboardNav consumes this to render collapsible groups,
 * while `getActivityNavigation` (the capability model) stays the single source
 * of WHICH modules exist for an activity. Unknown modules fall back to 'ops'
 * so a future module can never silently vanish from navigation.
 */

export type NavGroupId = 'ops' | 'communication' | 'finance' | 'settings';

export type NavModule = { module: string; label: string; icon?: string };

export type NavGroup = { id: NavGroupId; label: string; icon: string };

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'ops', label: 'التشغيل اليومي', icon: '🏥' },
  { id: 'communication', label: 'التواصل', icon: '💬' },
  { id: 'finance', label: 'المالية والنمو', icon: '📊' },
  { id: 'settings', label: 'الإعدادات والحساب', icon: '⚙️' },
];

/** module → group mapping (single source of truth for placement). */
const MODULE_GROUPS: Record<string, NavGroupId> = {
  overview: 'ops',
  appointments: 'ops',
  patients: 'ops',
  'imaging-requests': 'ops',
  'medical-files': 'ops',
  providers: 'ops',
  team: 'ops',
  conversations: 'communication',
  messages: 'communication',
  notifications: 'communication',
  leads: 'communication',
  'referring-clinics': 'communication',
  'imaging-centers': 'communication',
  'financial-intelligence': 'finance',
  analytics: 'finance',
  growth: 'finance',
  subscription: 'finance',
  'knowledge-base': 'settings',
  'ai-settings': 'settings',
  'communication-settings': 'settings',
  ads: 'settings',
  setup: 'settings',
  'clinic-setup': 'settings',
  'public-page': 'settings',
  'public-content': 'settings',
  profile: 'settings',
};

export function groupForModule(module: string): NavGroupId {
  return MODULE_GROUPS[module] ?? 'ops';
}

export type GroupedNav = NavGroup & { items: NavModule[] };

/** Bucket links into NAV_GROUPS order; per-group items keep their input order. */
export function groupNavLinks(links: NavModule[]): GroupedNav[] {
  const buckets = new Map<NavGroupId, NavModule[]>();
  for (const link of links) {
    const id = groupForModule(link.module);
    const bucket = buckets.get(id) ?? [];
    bucket.push(link);
    buckets.set(id, bucket);
  }
  return NAV_GROUPS.map((group) => ({ ...group, items: buckets.get(group.id) ?? [] }));
}
