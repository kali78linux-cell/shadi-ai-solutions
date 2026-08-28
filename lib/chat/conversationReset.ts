/**
 * NEW-CONVERSATION ISOLATION (P1 root-cause fix)
 *
 * Bug: opening a "new conversation" kept showing the old one. Root causes:
 *  1. There was NO new-conversation control at all — `conversation_id` was
 *     persisted in localStorage and restored forever.
 *  2. Booking context was persisted under a SEPARATE key (`${key}_booking`),
 *     so even if the conversation id were cleared, stale booking mode leaked
 *     into the next conversation.
 *
 * A new conversation MUST mean: new conversation_id + fresh UI state +
 * fresh PatientContext (server-side: a fresh conversation row starts with
 * empty metadata) + fresh state machine + fresh messages + fresh booking
 * context. The old conversation stays in the DB and remains visible in the
 * dashboard history.
 *
 * This module is PURE so the reset contract is unit-testable without a DOM:
 * nothing from the previous session may survive into the returned state.
 */

export type FreshConversationState = {
  /** Brand-new conversation — the server creates it on the next message. */
  conversationId: string | null;
  messages: Array<{ role: 'assistant' | 'user' | 'patient' | 'staff' | 'system'; text: string }>;
  showSuggested: boolean;
  statusMessage: string | null;
  aiUnavailable: boolean;
  // Booking flow context (per-conversation, must never carry over):
  bookingMode: boolean;
  bookingResult: unknown | null;
  bookingError: string | null;
  showBookingSummary: boolean;
  recommendedServiceId: string | null;
  recommendedProviderId: string | null;
  selectedService: string | null;
  selectedProvider: string | null;
  selectedDate: string | null;
  slots: string[];
  selectedSlot: string | null;
  patientName: string;
  patientPhone: string;
  patientEmail: string;
  // Cancel/reschedule panels:
  showCancel: boolean;
  cancelAppointmentId: string;
  cancelToken: string;
  cancelResult: unknown | null;
  cancelError: string | null;
  showReschedule: boolean;
  rescheduleAppointmentId: string;
  rescheduleToken: string;
  rescheduleResult: unknown | null;
  rescheduleError: string | null;
};

/**
 * The complete fresh state for a brand-new conversation. `welcomeText` is the
 * clinic's greeting banner (the only allowed content in a fresh conversation).
 */
export function freshConversationState(welcomeText: string): FreshConversationState {
  return {
    conversationId: null,
    messages: [{ role: 'assistant', text: welcomeText }],
    showSuggested: true,
    statusMessage: null,
    aiUnavailable: false,
    bookingMode: false,
    bookingResult: null,
    bookingError: null,
    showBookingSummary: false,
    recommendedServiceId: null,
    recommendedProviderId: null,
    selectedService: null,
    selectedProvider: null,
    selectedDate: null,
    slots: [],
    selectedSlot: null,
    patientName: '',
    patientPhone: '',
    patientEmail: '',
    showCancel: false,
    cancelAppointmentId: '',
    cancelToken: '',
    cancelResult: null,
    cancelError: null,
    showReschedule: false,
    rescheduleAppointmentId: '',
    rescheduleToken: '',
    rescheduleResult: null,
    rescheduleError: null,
  };
}

/**
 * localStorage keys that hold per-conversation client state and must be
 * purged when starting a new conversation. The old conversation itself is NOT
 * deleted server-side — only this device's pointer to it.
 */
export function conversationStorageKeysToPurge(storageKey: string): string[] {
  return [storageKey, `${storageKey}_booking`];
}
