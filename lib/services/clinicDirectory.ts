import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Clinic discovery layer — foundation for the future "nearby clinics" search
 * (Master Plan §14/§15). READ-ONLY, public-safe projection, and HONEST:
 * it never fabricates clinics or distances. Until real coordinates exist in
 * the database this legitimately returns an empty list.
 */

export type ClinicLocation = {
  latitude: number | null;
  longitude: number | null;
};

export type NearbyClinicQuery = {
  /** Patient-side point (backend-derived from opt-in device location). */
  location?: ClinicLocation;
  /** Manual area/city fallback when the patient didn't share a location. */
  area?: string;
  /** Optional service name filter (future: service id matching). */
  service?: string;
  limit?: number;
  /** Radius cap for coordinate search, in kilometers. Default 25km. */
  radiusKm?: number;
};

export type ClinicDirectoryEntry = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  distance_km: number | null;
};

const EARTH_RADIUS_KM = 6371;

/** Haversine distance in km between two coordinate points. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/**
 * Searches listed, active clinics by location and/or area.
 *
 * IMPORTANT: returns ONLY what the database truly contains. When nothing
 * matches, the honest result is `[]` — callers must present "لا توجد عيادات
 * مطابقة" and must never synthesize alternatives.
 */
export async function findNearbyClinics(query: NearbyClinicQuery): Promise<ClinicDirectoryEntry[]> {
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 50);
  const radiusKm = query.radiusKm ?? 25;

  let builder = supabaseAdmin
    .from('clinics')
    .select('id, slug, name, city, area, address, latitude, longitude')
    .is('deleted_at', null);

  if (!query.location && query.area) {
    builder = builder.or(`city.ilike.%${query.area}%,area.ilike.%${query.area}%`);
  }

  const { data, error } = await builder.limit(200);
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    area: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  };

  const rows = (data ?? []) as Row[];

  // Service filtering is deferred until the service catalog is linked into
  // the directory view; the field is accepted now for API stability.
  void query.service;

  const withDistance = rows
    .map((row) => {
      if (query.location && row.latitude != null && row.longitude != null) {
        return { ...row, distance_km: haversineKm(query.location.latitude, query.location.longitude, row.latitude, row.longitude) };
      }
      return { ...row, distance_km: null };
    })
    .filter((row) => (query.location ? row.distance_km != null && row.distance_km <= radiusKm : true))
    .sort((a, b) => {
      if (query.location) return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
      return a.name.localeCompare(b.name, 'ar');
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      address: row.address,
      distance_km: query.location ? row.distance_km : null,
    }));

  return withDistance;
}
