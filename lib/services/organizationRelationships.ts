import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * REFERRAL RELATIONSHIPS — service layer (PHASE F).
 *
 * Single source of truth for the organization_relationships lifecycle used by
 * BOTH dashboards:
 *   - Clinic dashboard  → /dashboard/{slug}/imaging-centers  (find imaging
 *     centers, send requests, see status, suspend active partnerships).
 *   - Imaging center    → /dashboard/{slug}/referring-clinics (accept/reject
 *     incoming requests, suspend/reactivate, outbound requests to clinics).
 *
 * The relationship is SYMMETRIC in the table (source_org_id/target_org_id,
 * either direction) — `direction` below is always relative to the viewing
 * tenant. Transition rules are pure + unit-tested (canTransitionRelationship).
 */

export type RelationshipStatus =
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'suspended'
  | 'canceled';

export type RelationshipParty = 'source' | 'target' | 'neither';

export type RelationshipDirection = 'outgoing' | 'incoming';

export type OrgRef = {
  id: string;
  name: string;
  slug: string | null;
  activity_type: string | null;
};

export type EnrichedRelationship = {
  id: string;
  status: RelationshipStatus;
  relationship_type: string;
  direction: RelationshipDirection;
  source_org: OrgRef;
  target_org: OrgRef;
  created_at: string;
  accepted_at: string | null;
};

export type PartnerOrg = {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  area: string | null;
  /** Latest relevant relationship with this org (null = never related). */
  relationship: {
    id: string;
    status: RelationshipStatus;
    direction: RelationshipDirection;
    relationship_type: string;
  } | null;
};

/**
 * Pure state machine for PATCH transitions. `party` is the calling tenant's
 * side relative to the relationship row.
 *
 * Rules:
 *   - requested → accepted : TARGET only (the invited org accepts).
 *   - requested → rejected/canceled : either party (target declines or source
 *     withdraws).
 *   - accepted → suspended : either party.
 *   - suspended → accepted : either party (reactivation).
 *   - suspended → rejected/canceled : either party.
 *   - rejected/canceled : terminal (re-request creates a NEW row).
 */
export function canTransitionRelationship(
  from: RelationshipStatus,
  to: RelationshipStatus,
  party: RelationshipParty
): boolean {
  if (from === to) return false;
  if (party === 'neither') return false;
  switch (from) {
    case 'requested':
      if (to === 'accepted') return party === 'target';
      if (to === 'rejected' || to === 'canceled') return true;
      return false;
    case 'accepted':
      return to === 'suspended';
    case 'suspended':
      return to === 'accepted' || to === 'rejected' || to === 'canceled';
    case 'rejected':
    case 'canceled':
    default:
      return false;
  }
}

/** Arabic labels shared by both dashboards. */
export function relationshipStatusLabelAr(status: string): string {
  switch (status) {
    case 'requested':
      return 'قيد الانتظار';
    case 'accepted':
      return 'مقبول';
    case 'rejected':
      return 'مرفوض';
    case 'suspended':
      return 'معلّق';
    case 'canceled':
      return 'ملغي';
    default:
      return status;
  }
}

export function relationshipStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'accepted':
      return 'success';
    case 'requested':
      return 'warning';
    case 'suspended':
    case 'rejected':
    case 'canceled':
      return 'danger';
    default:
      return 'neutral';
  }
}

type RawRelationshipRow = {
  id: string;
  source_org_id: string;
  target_org_id: string;
  relationship_type: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
};

function mapStatus(value: string): RelationshipStatus {
  return (['requested', 'accepted', 'rejected', 'suspended', 'canceled'] as const).includes(
    value as RelationshipStatus
  )
    ? (value as RelationshipStatus)
    : 'requested';
}

async function loadOrgRefs(orgIds: string[]): Promise<Map<string, OrgRef>> {
  const map = new Map<string, OrgRef>();
  if (orgIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from('clinics')
    .select('id, name, slug, activity_type')
    .in('id', orgIds);
  if (error) return map;
  for (const row of data ?? []) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug ?? null,
      activity_type: row.activity_type ?? null,
    });
  }
  return map;
}

async function loadRelationshipRows(clinicId: string): Promise<RawRelationshipRow[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_relationships')
    .select(
      'id, source_org_id, target_org_id, relationship_type, status, created_at, accepted_at'
    )
    .or(`source_org_id.eq.${clinicId},target_org_id.eq.${clinicId}`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as RawRelationshipRow[];
}

/** All relationships for a tenant, enriched with BOTH org identities. */
export async function listRelationshipsForTenant(
  clinicId: string
): Promise<EnrichedRelationship[]> {
  const rows = await loadRelationshipRows(clinicId);
  const orgMap = await loadOrgRefs(
    Array.from(new Set(rows.flatMap((r) => [r.source_org_id, r.target_org_id])))
  );
  const fallback = (id: string): OrgRef => ({
    id,
    name: id.slice(0, 8) + '…',
    slug: null,
    activity_type: null,
  });
  return rows.map((r) => ({
    id: r.id,
    status: mapStatus(r.status),
    relationship_type: r.relationship_type,
    direction: r.source_org_id === clinicId ? 'outgoing' : 'incoming',
    source_org: orgMap.get(r.source_org_id) ?? fallback(r.source_org_id),
    target_org: orgMap.get(r.target_org_id) ?? fallback(r.target_org_id),
    created_at: r.created_at,
    accepted_at: r.accepted_at,
  }));
}

/**
 * Partner orgs of a given activity (excluding the calling tenant), each
 * annotated with the tenant's latest relevant relationship. Priority when
 * several rows exist: accepted > requested > suspended > rejected/canceled.
 */
export async function listPartnerOrgsWithStatus(
  clinicId: string,
  activityType: 'imaging_center' | 'clinic' | 'dental_lab'
): Promise<PartnerOrg[]> {
  const [{ data: orgs, error }, relRows] = await Promise.all([
    supabaseAdmin
      .from('clinics')
      .select('id, name, slug, city, area')
      .eq('activity_type', activityType)
      .neq('id', clinicId)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    loadRelationshipRows(clinicId),
  ]);
  if (error) throw new Error(error.message);

  const priority: Record<string, number> = { accepted: 3, requested: 2, suspended: 1 };
  const byPartner = new Map<string, RawRelationshipRow>();
  for (const row of relRows) {
    const partnerId = row.source_org_id === clinicId ? row.target_org_id : row.source_org_id;
    const current = byPartner.get(partnerId);
    if (!current || (priority[row.status] ?? 0) > (priority[current.status] ?? 0)) {
      byPartner.set(partnerId, row);
    }
  }

  return (orgs ?? []).map((org) => {
    const rel = byPartner.get(org.id);
    return {
      id: org.id,
      name: org.name,
      slug: org.slug ?? null,
      city: org.city ?? null,
      area: org.area ?? null,
      relationship: rel
        ? {
            id: rel.id,
            status: mapStatus(rel.status),
            direction: rel.source_org_id === clinicId ? ('outgoing' as const) : ('incoming' as const),
            relationship_type: rel.relationship_type,
          }
        : null,
    };
  });
}
