/**
 * PURE clinic-gate decision logic for /chat.
 *
 * ROOT-CAUSE FIX context: /chat used to trust any ?clinic= string (and the
 * dashboard never passed one at all), so patients saw "لم يتم تحديد العيادة"
 * even while inside a specific clinic dashboard. These helpers encapsulate
 * the identifier handling so it can be unit-tested without React:
 *   - slug vs uuid detection → correct resolvePublicClinic query key
 *   - lookup payload → honest gate state (ready | not_found)
 * The component (ChatClinicGate) performs the actual server validation.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True when the identifier is a Postgres uuid (dashboard-originated links). */
export function isClinicUuid(identifier: string): boolean {
  return UUID_RE.test(identifier);
}

/**
 * Builds the query string for /api/booking/clinic (backed by
 * resolvePublicClinic). resolvePublicClinic accepts either key — but we must
 * send the RIGHT one: sending a uuid as ?slug= silently resolves nothing.
 */
export function buildClinicLookupQuery(identifier: string): string {
  return isClinicUuid(identifier)
    ? `clinic_id=${encodeURIComponent(identifier)}`
    : `slug=${encodeURIComponent(identifier)}`;
}

export type ClinicLookupOutcome =
  | { kind: 'ready'; clinicId: string; clinicName: string | null }
  | { kind: 'not_found' };

/** Maps the /api/booking/clinic response onto a gate decision. */
export function clinicGateStateFromPayload(payload: unknown): ClinicLookupOutcome {
  const data = (payload as { data?: { id?: unknown; name?: unknown } } | null)?.data;
  if (data && typeof data.id === 'string' && data.id.length > 0) {
    return {
      kind: 'ready',
      clinicId: data.id,
      clinicName: typeof data.name === 'string' && data.name.trim() ? data.name : null,
    };
  }
  return { kind: 'not_found' };
}

/**
 * ROOT-CAUSE FIX (intermittent "المساعد غير متاح" bug):
 * The chat UI used to pick its API endpoint by GUESSING the identifier SHAPE
 * (uuid ⇒ authenticated /api/ai/messages). But the public gate hands over the
 * RESOLVED DB uuid, so anonymous visitors were silently sent to the
 * session-protected route and got HTTP 401 for EVERY message regardless of
 * content. Endpoint selection must be an EXPLICIT mode, never inferred from
 * the identifier format.
 */
export type ChatApiMode = 'public' | 'staff';

/** The single source of truth for chat endpoint selection. */
export function chatEndpointForMode(mode: ChatApiMode): '/api/public/ai/messages' | '/api/ai/messages' {
  return mode === 'staff' ? '/api/ai/messages' : '/api/public/ai/messages';
}