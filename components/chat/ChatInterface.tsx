'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { freshConversationState, conversationStorageKeysToPurge } from '@/lib/chat/conversationReset';
import { applyPendingBookingContext, type PendingBookingContext, type BookingUiProjection } from '@/lib/ai/bookingContextBridge';
import { validateBookingPhone } from '@/lib/booking/bookingPhone';

type ChatMessage = {
  id?: string;
  role: 'assistant' | 'user' | 'patient' | 'staff' | 'system';
  text: string;
};

type Props = {
  clinicId?: string;
  initialConversationId?: string | null;
  /** Render in a full-height panel (floating widget) instead of a tall card. */
  embedded?: boolean;
  /**
   * Explicit API mode. NEVER inferred from the identifier shape (that caused
   * anonymous visitors to hit the session-protected route → 401 everywhere).
   * Public chat pages/widgets leave the default 'public'.
   */
};

const STORAGE_KEY_PREFIX = 'dentalai_chat_conv_';
const MAX_MESSAGE_LENGTH = 2000;

const SUGGESTED_QUESTIONS = [
  'ما هي خدمات العيادة؟',
  'كم سعر تنظيف الأسنان؟',
  'أريد حجز موعد',
  'ما أوقات الدوام؟',
];

export default function ChatInterface({ clinicId = '', initialConversationId = null, embedded = false }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [clinicName, setClinicName] = useState<string | null>(null);
  const [assistantName, setAssistantName] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [showSuggested, setShowSuggested] = useState(true);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef<string | null>(null);

  // Booking flow state
  const [publicClinicId, setPublicClinicId] = useState<string | null>(null);
  const [services, setServices] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [recommendedServiceId, setRecommendedServiceId] = useState<string | null>(null);
  const [recommendedProviderId, setRecommendedProviderId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [patientName, setPatientName] = useState<string>('');
  const [patientPhone, setPatientPhone] = useState<string>('');
  const [patientEmail, setPatientEmail] = useState<string>('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<any | null>(null);
  const [showBookingSummary, setShowBookingSummary] = useState(false);
  const [bookingMode, setBookingMode] = useState(false);
  const [bookingModeLoaded, setBookingModeLoaded] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelAppointmentId, setCancelAppointmentId] = useState('');
  const [cancelToken, setCancelToken] = useState('');
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<any | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState('');
  const [rescheduleToken, setRescheduleToken] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [rescheduleResult, setRescheduleResult] = useState<any | null>(null);

  const isUuid = /^[0-9a-fA-F-]{36}$/.test(clinicId);
const clinicQueryField = isUuid ? 'clinic_id' : 'clinic_slug';
  const storageKey = `${STORAGE_KEY_PREFIX}${clinicId}`;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSubmitting]);

  // Load clinic info + welcome message
  useEffect(() => {
    if (!clinicId) return;
    async function loadClinicInfo() {
      try {
        // resolvePublicClinic accepts either identifier — query with the right key
        // so dashboard-originated UUID links ALSO resolve the real clinic name.
        const query = isUuid
          ? `clinic_id=${encodeURIComponent(clinicId)}`
          : `slug=${encodeURIComponent(clinicId)}`;
        const res = await fetch(`/api/booking/clinic?${query}`);
        if (res.ok) {
          const payload = await res.json();
          setClinicName(payload?.data?.name ?? null);
          setPublicClinicId(payload?.data?.id ?? null);
        }
      } catch {
        // Non-fatal — fallback welcome below
      }
    }
    void loadClinicInfo();
  }, [clinicId, isUuid]);

  // Load conversation history on mount
  useEffect(() => {
    async function loadHistory() {
      setIsLoadingHistory(true);
      // Restore conversation_id from localStorage
      const savedConvId = localStorage.getItem(storageKey);
      const effectiveConvId = conversationId ?? savedConvId;

      if (effectiveConvId) {
        // Root-fix: visitors ALWAYS use the public route. No endpoint guessing by identifier shape.
      const base = '/api/public/ai/messages';
        const params = isUuid
          ? `conversation_id=${effectiveConvId}&clinic_id=${clinicId}`
          : `conversation_id=${effectiveConvId}&${clinicQueryField}=${encodeURIComponent(clinicId)}`;
        try {
          const response = await fetch(`${base}?${params}`);
          if (response.ok) {
            const payload = await response.json();
            const items = Array.isArray(payload?.data) ? payload.data : [];
            if (items.length > 0) {
              setMessages(items.map((item: any) => ({
                id: item.id,
                role: item.role === 'assistant' ? 'assistant' : 'user',
                text: item.content,
              })));
              setConversationId(effectiveConvId);
              setShowSuggested(false);
              // STEP 7: restore canonical booking state into the UI after reload
              // (server state wins over stale localStorage; no invented slots).
              if (payload?.booking_context?.recommended_service_id) {
                setRecommendedServiceId(payload.booking_context.recommended_service_id);
              }
              if (payload?.booking_context?.recommended_provider_id) {
                setRecommendedProviderId(payload.booking_context.recommended_provider_id);
              }
              applyBookingContextToUi(payload?.booking_context ?? null);
              setIsLoadingHistory(false);
              return;
            }
          }
        } catch {
          // Fall through to welcome message
        }
      }

      // No history — show welcome message
      const fallbackWelcome = clinicName
        ? `أهلًا بك في ${clinicName} 👋\nأنا ${assistantName ?? 'موظفة الاستقبال الافتراضية'}. كيف يمكنني مساعدتك؟`
        : 'أهلًا بك 👋\nأنا موظفة الاستقبال الافتراضية. كيف يمكنني مساعدتك؟';
      setMessages([{ role: 'assistant', text: welcomeMessage ?? fallbackWelcome }]);
      setShowSuggested(true);
      setIsLoadingHistory(false);
    }

    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, isUuid]);

  // Persist conversation_id to localStorage whenever it changes
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(storageKey, conversationId);
    }
  }, [conversationId, storageKey]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();

    // Empty / whitespace-only validation
    if (!trimmed) {
      setStatusMessage('يرجى كتابة رسالة قبل الإرسال.');
      return;
    }

    // Long message validation
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setStatusMessage(`الرسالة طويلة جدًا. الحد الأقصى ${MAX_MESSAGE_LENGTH} حرفًا.`);
      return;
    }

    // Duplicate message protection
    if (lastSentRef.current === trimmed && isSubmitting) {
      return;
    }
    lastSentRef.current = trimmed;

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setDraft('');
    setIsSubmitting(true);
    setStatusMessage(null);
    setAiUnavailable(false);
    setShowSuggested(false);

    try {
      // Root-fix: visitors ALWAYS use the public route. No endpoint guessing by identifier shape.
      const base = '/api/public/ai/messages';
      const payloadBody = isUuid
        ? { clinic_id: clinicId, conversation_id: conversationId, text: trimmed, stream: false }
        : { [clinicQueryField]: clinicId, conversation_id: conversationId, text: trimmed, stream: false };

      const response = await fetch(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payloadBody),
      });

      // Parse body safely (may be non-JSON). We never blindly assume JSON.
      let payload: any = {};
      try {
        payload = await response.json();
      } catch {
        payload = { error: 'Unreadable server response' };
      }

      if (!response.ok) {
        // Log the REAL error on the client for diagnosis (not just a friendly fallback).
        console.warn('Chat AI request failed:', response.status, payload?.error ?? response.statusText);

        // Distinguish "clinic not found" from a generic AI/provider error.
        const errText = String(payload?.error ?? '').toLowerCase();
        const isClinicNotFound =
          response.status === 404 && (errText.includes('clinic not found') || errText.includes('conversation not found'));

        if (isClinicNotFound) {
          setAiUnavailable(true);
          setMessages((current) => [
            ...current,
            { role: 'assistant', text: 'لم نستطع تحديد العيادة المطلوبة. تأكد من رابط العيادة ثم أعد المحاولة.' },
          ]);
          return;
        }

        // RATE LIMITED (429): an HONEST, specific message surfaced verbatim from
        // the server. The old behavior lumped this into "المساعد غير متاح" which
        // was both untrue and drove users to retry harder into the same limit.
        if (response.status === 429) {
          const rateLimitText = String(payload?.error ?? '') || 'أرسلت رسائل كثيرة بسرعة. انتظر قليلاً ثم أعد المحاولة.';
          setMessages((current) => [...current, { role: 'assistant', text: rateLimitText }]);
          return;
        }

        // SERVER/PROVIDER FAILURE (5xx and opaque errors): the ONE case where
        // "المساعد غير متاح حاليًا" is truthful — a real upstream failure that
        // is also logged server-side (public_ai_message_error) with its cause.
        setAiUnavailable(true);
        const friendly = 'عذرًا، يبدو أن المساعد غير متاح حاليًا. يمكنك ترك رقم هاتفك وسيتواصل معك فريق العيادة.';
        setMessages((current) => [...current, { role: 'assistant', text: friendly }]);
        return;
      }

      const assistantText = payload?.assistant_message?.content ?? payload?.assistant_message ?? 'تمت معالجة الرسالة.';
      setConversationId(payload?.conversation_id ?? conversationId);
      // STEP 7: reflect canonical booking state into the UI projection when a
      // recommendation/slot is present. The response's booking_context is the
      // derived value we store in recommended ids so loadServicesForClinic can
      // prefill from operating data.
      if (payload?.booking_context?.recommended_service_id) {
        setRecommendedServiceId(payload.booking_context.recommended_service_id);
      }
      if (payload?.booking_context?.recommended_provider_id) {
        setRecommendedProviderId(payload.booking_context.recommended_provider_id);
      }
      setMessages((current) => [...current, { role: 'assistant', text: assistantText }]);
      applyBookingContextToUi(payload?.booking_context ?? null);

      // If assistant returned structured metadata suggesting booking intent, prepare services
      try {
        const assistantMeta = payload?.assistant_message?.metadata ?? null;
        const intent = assistantMeta?.intelligence?.intent ?? null;
        if (intent === 'appointment_booking') {
          if (!publicClinicId && !isUuid) {
            const clinicResp = await fetch(`/api/booking/clinic?slug=${encodeURIComponent(clinicId)}`);
            if (clinicResp.ok) {
              const clinicPayload = await clinicResp.json();
              setPublicClinicId(clinicPayload?.data?.id ?? null);
            }
          }
        }
      } catch {
        // ignore — booking flow will re-fetch when user invokes it
      }
    } catch (err) {
      // Network-level failure (offline / server unreachable) — DISTINCT from
      // "assistant unavailable": the browser itself could not complete the
      // request, so blaming the AI provider would be misleading.
      console.warn('[ai chat] request threw:', err);
      setAiUnavailable(true);
      setMessages((current) => [
        ...current,
        { role: 'assistant', text: 'تعذّر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.' },
      ]);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Booking flow helpers
  async function loadServicesForClinic() {
    setBookingError(null);
    setBookingResult(null);
    const cid = publicClinicId ?? (isUuid ? clinicId : null);
    if (!cid) return setBookingError('Unable to resolve clinic for booking');
    try {
      const res = await fetch(`/api/booking/services?clinic_id=${cid}`);
      if (!res.ok) throw new Error('Failed to load services');
      const payload = await res.json();
      const loadedServices = payload?.data?.services ?? [];
      setServices(loadedServices);
      const preferredService = loadedServices.find((service: any) => service.id === recommendedServiceId)?.id;
      const serviceToSelect = preferredService ?? (loadedServices.length === 1 ? loadedServices[0].id : null);
      if (serviceToSelect) {
        setSelectedService(serviceToSelect);
        await loadProvidersForService(serviceToSelect, recommendedProviderId);
      }
    } catch (err: any) {
      setBookingError(err?.message ?? 'Failed to load services');
    }
  }

  // Explicit booking activation — the ONLY way the booking UI becomes visible.
  function activateBooking() {
    setBookingMode(true);
    setBookingError(null);
    setBookingResult(null);
    if (publicClinicId && services.length === 0) {
      void loadServicesForClinic();
    }
  }

  // STEP 7 — Persist a Booking UI selection into the canonical conversation
  // state (server-side). Never invents a slot: the server re-validates any slot
  // against real availability. Non-fatal on failure (in-memory flow continues).
  async function persistUiToConversation(patch: {
    service_id?: string | null;
    provider_id?: string | null;
    date?: string | null;
    slot?: string | null;
    patient_name?: string;
    phone?: string;
    email?: string;
    confirmed?: boolean;
  }) {
    if (!conversationId) return;
    try {
      const clinicKey = isUuid ? { clinic_id: clinicId } : { clinic_slug: clinicId };
      await fetch('/api/public/ai/booking-context', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...clinicKey,
          conversation_id: conversationId,
          ...(patch.service_id ? { service_id: patch.service_id } : {}),
          ...(patch.provider_id ? { provider_id: patch.provider_id } : {}),
          ...(patch.date ? { date: patch.date } : {}),
          ...(patch.slot ? { slot: patch.slot } : {}),
          ...(patch.patient_name !== undefined ? { patient_name: patch.patient_name } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.confirmed ? { confirmed: true } : {}),
        }),
      });
    } catch {
      // non-fatal — the in-memory booking flow still works this turn
    }
  }

  // STEP 7 — Reflect the canonical conversation booking state into the UI.
  // The UI is a projection: server-verified service/provider ids and a real
  // slot become the initial selections ONLY where the user hasn't chosen yet.
  function applyBookingContextToUi(ctx: PendingBookingContext | null) {
    if (!ctx) return;
    const ui: BookingUiProjection = {
      selectedService,
      selectedProvider,
      selectedDate,
      selectedSlot,
      showBookingSummary,
      patientName,
      patientPhone,
      patientEmail,
      bookingMode,
    };
    const next = applyPendingBookingContext(ui, ctx);
    if (next.selectedService !== selectedService) setSelectedService(next.selectedService);
    if (next.selectedProvider !== selectedProvider) setSelectedProvider(next.selectedProvider);
    if (next.selectedDate !== selectedDate) setSelectedDate(next.selectedDate);
    if (next.selectedSlot !== selectedSlot) setSelectedSlot(next.selectedSlot);
    if (next.showBookingSummary) setShowBookingSummary(true);
    if (next.patientName !== patientName) setPatientName(next.patientName);
    if (next.patientPhone !== patientPhone) setPatientPhone(next.patientPhone);
    if (next.patientEmail !== patientEmail) setPatientEmail(next.patientEmail);
    if (next.bookingMode && !bookingMode) setBookingMode(true);
  }

  // NEW-CONVERSATION ISOLATION (root-cause fix): starts a genuinely fresh
  // conversation — new conversation_id on the next message, fresh messages,
  // fresh PatientContext/state-machine (server-side: new conversation row has
  // empty metadata), and fresh booking context. The old conversation remains
  // in the database and stays visible in the clinic dashboard history.
  const startNewConversation = useCallback(() => {
    const welcome = welcomeMessage
      ?? (clinicName ? `أهلًا بك في ${clinicName} 👋\nأنا ${assistantName ?? 'موظفة الاستقبال الافتراضية'}. كيف يمكنني مساعدتك؟` : 'أهلًا بك 👋\nأنا موظفة الاستقبال الافتراضية. كيف يمكنني مساعدتك؟');
    const fresh = freshConversationState(welcome);

    setMessages(fresh.messages);
    setConversationId(fresh.conversationId);
    setShowSuggested(fresh.showSuggested);
    setStatusMessage(fresh.statusMessage);
    setAiUnavailable(fresh.aiUnavailable);
    setBookingMode(fresh.bookingMode);
    setBookingResult(fresh.bookingResult);
    setBookingError(fresh.bookingError);
    setShowBookingSummary(fresh.showBookingSummary);
    setRecommendedServiceId(fresh.recommendedServiceId);
    setRecommendedProviderId(fresh.recommendedProviderId);
    setSelectedService(fresh.selectedService);
    setSelectedProvider(fresh.selectedProvider);
    setSelectedDate(fresh.selectedDate);
    setSlots(fresh.slots);
    setSelectedSlot(fresh.selectedSlot);
    setPatientName(fresh.patientName);
    setPatientPhone(fresh.patientPhone);
    setPatientEmail(fresh.patientEmail);
    setShowCancel(fresh.showCancel);
    setCancelAppointmentId(fresh.cancelAppointmentId);
    setCancelToken(fresh.cancelToken);
    setCancelResult(fresh.cancelResult);
    setCancelError(fresh.cancelError);
    setShowReschedule(fresh.showReschedule);
    setRescheduleAppointmentId(fresh.rescheduleAppointmentId);
    setRescheduleToken(fresh.rescheduleToken);
    setRescheduleResult(fresh.rescheduleResult);
    setRescheduleError(fresh.rescheduleError);
    lastSentRef.current = null;

    // Purge this device's pointers (conversation id + booking context).
    // The conversation itself is NOT deleted server-side.
    try {
      for (const key of conversationStorageKeysToPurge(storageKey)) {
        localStorage.removeItem(key);
      }
    } catch {
      // localStorage unavailable (private mode) — state reset above is enough.
    }
  }, [welcomeMessage, clinicName, assistantName, storageKey]);

  // Restore bookingMode from localStorage (so refresh preserves booking context)
  useEffect(() => {
    const saved = localStorage.getItem(`${storageKey}_booking`);
    if (saved === 'true') {
      setBookingMode(true);
    }
    setBookingModeLoaded(true);
  }, [storageKey]);

  // Persist bookingMode
  useEffect(() => {
    if (bookingModeLoaded) {
      localStorage.setItem(`${storageKey}_booking`, bookingMode ? 'true' : 'false');
    }
  }, [bookingMode, bookingModeLoaded, storageKey]);

  // Load services ONLY when booking is explicitly activated.
  // This is the key fix: services may exist, but the booking UI must NOT
  // appear merely because the clinic resolved or services exist.
  useEffect(() => {
    if (bookingMode && publicClinicId && services.length === 0) {
      void loadServicesForClinic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingMode, publicClinicId]);

  async function loadProvidersForService(serviceId?: string, preferredProviderId?: string | null) {
    setBookingError(null);
    const cid = publicClinicId ?? (isUuid ? clinicId : null);
    if (!cid) return setBookingError('Unable to resolve clinic for booking');
    try {
      const url = new URL('/api/booking/providers', location.origin);
      url.searchParams.set('clinic_id', cid);
      if (serviceId) url.searchParams.set('service_id', serviceId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Failed to load providers');
      const payload = await res.json();
      const loadedProviders = payload?.data?.providers ?? [];
      setProviders(loadedProviders);
      const preferredProvider = loadedProviders.find((provider: any) => provider.id === preferredProviderId)?.id;
      if (preferredProvider) setSelectedProvider(preferredProvider);
      else if (loadedProviders.length === 1) setSelectedProvider(loadedProviders[0].id);
    } catch (err: any) {
      setBookingError(err?.message ?? 'Failed to load providers');
    }
  }

  async function loadSlotsForProviderAndDate(providerId: string, date: string) {
    setBookingError(null);
    setSlots([]);
    setSelectedSlot(null);
    const cid = publicClinicId ?? (isUuid ? clinicId : null);
    if (!cid) return setBookingError('Unable to resolve clinic for booking');
    try {
      const url = new URL('/api/booking/availability', location.origin);
      url.searchParams.set('clinic_id', cid);
      url.searchParams.set('provider_id', providerId);
      url.searchParams.set('date', date);
      if (selectedService) url.searchParams.set('service_id', selectedService);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to load availability');
      }
      const payload = await res.json();
      setSlots(payload?.data?.slots ?? []);
    } catch (err: any) {
      setBookingError(err?.message ?? 'Failed to load slots');
    }
  }

  async function submitBooking() {
    setBookingError(null);
    setBookingLoading(true);
    setBookingResult(null);
    try {
      const cid = publicClinicId ?? (isUuid ? clinicId : null);
      if (!cid) throw new Error('Unable to resolve clinic for booking');
      if (!selectedProvider || !selectedSlot) throw new Error('Please select provider and time slot');
      if (!patientName) throw new Error('Please provide your name');
      // FIX C: phone is REQUIRED by the booking API — reject client-side with a
      // clear message before any POST (previously sent null → 400 Invalid booking request).
      const validPhone = validateBookingPhone(patientPhone);
      if (!validPhone) throw new Error('رقم الهاتف مطلوب لإتمام الحجز — يرجى إدخال رقم هاتف صحيح (٥ خانات على الأقل)');

      const [date, time] = selectedSlot.split('T')[0] ? [selectedSlot.split('T')[0], selectedSlot.split('T')[1].slice(0,5)] : [selectedDate ?? '', selectedSlot ?? ''];

      const body = {
        clinic_id: cid,
        provider_id: selectedProvider,
        service: services.find((s) => s.id === selectedService)?.name ?? (selectedService ?? 'Service'),
        service_id: selectedService ?? undefined,
        conversation_id: conversationId,
        date: date,
        time: time,
        patient_name: patientName,
        phone: validPhone,
        email: patientEmail || null,
      };

      const res = await fetch('/api/booking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Booking failed');

      setBookingResult(payload.data ?? payload);
      setShowBookingSummary(false);
      // Append assistant confirmation message to chat timeline
      setMessages((current) => [...current, { role: 'assistant', text: 'تم حجز موعدك بنجاح ✅' }]);
      // Clear booking form (keep clinic context)
      setSelectedService(null);
      setSelectedProvider(null);
      setSelectedDate(null);
      setSelectedSlot(null);
      setPatientName('');
      setPatientEmail('');
      setPatientPhone('');
    } catch (err: any) {
      setBookingError(err?.message ?? 'Booking failed');
    } finally {
      setBookingLoading(false);
    }
  }

  function handleSlotSelect(slot: string) {
    setSelectedSlot(slot);
    setShowBookingSummary(true);
    // STEP 7: persist the real slot + provider into canonical conversation state.
    const [dateFromSlot] = slot.split('T');
    void persistUiToConversation({
      service_id: selectedService,
      provider_id: selectedProvider,
      date: dateFromSlot || selectedDate,
      slot,
    });
  }

  function handleCancelRequest() {
    if (!cancelAppointmentId || !cancelToken) {
      setCancelError('يرجى إدخال رقم الموعد ورمز التأكيد.');
      return;
    }
    setShowCancelConfirm(true);
  }

  async function confirmCancellation() {
    setCancelError(null);
    setCancelLoading(true);
    setCancelResult(null);
    try {
      const cid = publicClinicId ?? (isUuid ? clinicId : null);
      if (!cid) throw new Error('Unable to resolve clinic');
      const res = await fetch('/api/booking/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinic_id: cid, appointment_id: cancelAppointmentId, token: cancelToken }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? 'Cancel failed');
      setCancelResult(payload.data ?? payload);
      setShowCancelConfirm(false);
      setMessages((current) => [...current, { role: 'assistant', text: 'تم إلغاء الحجز بنجاح.' }]);
    } catch (err: any) {
      setCancelError(err?.message ?? 'Cancel failed');
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <div
      className={`flex flex-col rounded-[2rem] border border-slate-800 bg-slate-900/80 shadow-xl shadow-slate-950/30 ${
        embedded ? 'h-full w-full' : 'min-h-[40rem]'
      }`}
    >
      <div className="flex items-start justify-between rounded-t-[2rem] bg-slate-950/90 px-6 py-5">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
            {assistantName ? `${assistantName} — ` : ''}محادثة AI
          </p>
          {clinicName && <p className="mt-1 text-xs text-slate-400">{clinicName}</p>}
        </div>
        {/* New Conversation: full isolation from the previous session. */}
        {!isLoadingHistory && (
          <button
            type="button"
            onClick={startNewConversation}
            disabled={isSubmitting}
            aria-label="بدء محادثة جديدة"
            title="ابدأ محادثة جديدة — المحادثة الحالية تبقى محفوظة في السجل"
            className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-500/70 hover:text-white disabled:opacity-50"
          >
            + محادثة جديدة
          </button>
        )}
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {statusMessage ? (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{statusMessage}</div>
        ) : null}

        {isLoadingHistory ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
            جارٍ تحميل المحادثة...
          </div>
        ) : (
          <>
            {messages.map((message, index) => (
              <div
                key={message.id ?? `${message.role}-${index}`}
                className={`rounded-3xl px-5 py-4 ${
                  message.role === 'assistant'
                    ? 'bg-slate-950 text-slate-200'
                    : 'bg-cyan-500/10 text-cyan-200 self-end'
                }`}
              >
                <p className="text-sm leading-6 whitespace-pre-wrap">{message.text}</p>
              </div>
            ))}

            {isSubmitting && (
              <div className="flex items-center gap-2 rounded-3xl bg-slate-950 px-5 py-4 text-sm text-slate-400">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
                جارٍ الكتابة...
              </div>
            )}

            {showSuggested && messages.length <= 1 && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-slate-500">أسئلة مقترحة:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        setDraft(q);
                        setShowSuggested(false);
                      }}
                      className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-500/70 hover:text-white"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {aiUnavailable && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <p>يمكنك ترك رقم هاتفك هنا وسيتواصل معك فريق العيادة.</p>
                <input
                  type="tel"
                  placeholder="رقم الهاتف (اختياري)"
                  className="mt-2 w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100"
                />
              </div>
            )}

            {/* Booking UI */}
            <div>
              {bookingResult ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-700/10 p-4 text-emerald-200">
                  <p className="font-semibold">حجز تم إنشاؤه ✅</p>
                  <p className="text-sm">الخدمة: {bookingResult?.service}</p>
                  <p className="text-sm">التاريخ: {bookingResult?.date} — الوقت: {bookingResult?.time}</p>
                  <p className="text-sm">الحالة: {bookingResult?.status}</p>
                  {bookingResult?.appointment_id && (
                    <p className="text-sm">رقم الحجز: {bookingResult.appointment_id.slice(0, 8)}</p>
                  )}
                </div>
              ) : null}

              {!bookingMode ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={activateBooking}
                    className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-semibold text-white"
                  >
                    ابدأ الحجز
                  </button>
                  {bookingError ? <p className="text-sm text-rose-300">{bookingError}</p> : null}
                </div>
              ) : !services || services.length === 0 ? (
                <div className="mt-3 flex gap-2">
                  <p className="text-sm text-slate-400">جارٍ تحميل الخدمات...</p>
                  {bookingError ? <p className="text-sm text-rose-300">{bookingError}</p> : null}
                </div>
              ) : (
                <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                  <div>
                    <label className="block text-sm text-slate-300">الخدمة</label>
                    <select value={selectedService ?? ''} onChange={(e) => { setSelectedService(e.target.value); void loadProvidersForService(e.target.value); setShowBookingSummary(false); }} className="mt-1 w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100">
                      <option value="">اختر خدمة</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} {s.price ? `— ${s.price}₪` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm text-slate-300">الطبيب</label>
                    <select value={selectedProvider ?? ''} onChange={(e) => { setSelectedProvider(e.target.value); setShowBookingSummary(false); }} className="mt-1 w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100">
                      <option value="">اختر طبيب</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-slate-300">التاريخ</label>
                      <input type="date" value={selectedDate ?? ''} onChange={(e) => { setSelectedDate(e.target.value); setSlots([]); setSelectedSlot(null); setShowBookingSummary(false); }} className="mt-1 w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                    </div>
                    <div className="flex items-end">
                      <button type="button" onClick={() => { if (selectedProvider && selectedDate) void loadSlotsForProviderAndDate(selectedProvider, selectedDate); }} className="w-full rounded-full bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">عرض الأوقات</button>
                    </div>
                  </div>

                  {slots.length > 0 && (
                    <div className="space-y-2">
                      <label className="block text-sm text-slate-300">الأوقات المتاحة</label>
                      <div className="flex flex-wrap gap-2">
                        {slots.map((slot) => (
                          <button key={slot} type="button" onClick={() => handleSlotSelect(slot)} className={`rounded-md px-3 py-2 text-sm ${selectedSlot === slot ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>
                            {slot.split('T')[1]?.slice(0, 5) ?? slot}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {showBookingSummary && selectedSlot && (
                    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-100">
                      <p className="font-semibold text-white">ملخص الحجز:</p>
                      <p>الخدمة: {services.find((s) => s.id === selectedService)?.name ?? '—'}</p>
                      <p>الطبيب: {providers.find((p) => p.id === selectedProvider)?.name ?? '—'}</p>
                      <p>التاريخ: {selectedSlot.split('T')[0]}</p>
                      <p>الوقت: {selectedSlot.split('T')[1]?.slice(0, 5)}</p>
                      <p>السعر: {services.find((s) => s.id === selectedService)?.price ? `${services.find((s) => s.id === selectedService).price}₪` : '—'}</p>
                      <p className="mt-2 text-xs text-cyan-300">هل تريد تأكيد الموعد؟</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2">
                    <input placeholder="الاسم *" value={patientName} onChange={(e) => { setPatientName(e.target.value); void persistUiToConversation({ patient_name: e.target.value }); }} className="mt-2 w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                    <input placeholder="الهاتف (مطلوب لإتمام الحجز)" value={patientPhone} onChange={(e) => { setPatientPhone(e.target.value); void persistUiToConversation({ phone: e.target.value }); }} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                    <input placeholder="البريد الإلكتروني (اختياري)" value={patientEmail} onChange={(e) => { setPatientEmail(e.target.value); void persistUiToConversation({ email: e.target.value }); }} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                  </div>

                  <div className="flex gap-2">
                    <button type="button" onClick={() => void submitBooking()} disabled={bookingLoading || !selectedSlot} className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{bookingLoading ? 'جارٍ الحجز...' : 'احجز الآن'}</button>
                    {bookingError ? <p className="text-sm text-rose-300">{bookingError}</p> : null}
                  </div>
                  <div className="mt-2 border-t border-slate-800 pt-2">
                    <button type="button" className="text-sm text-amber-300 underline" onClick={() => setShowCancel((s) => !s)}>{showCancel ? 'إخفاء إلغاء الحجز' : 'هل تريد إلغاء حجز؟'}</button>
                    {showCancel && (
                      <div className="mt-2 space-y-2">
                        <input placeholder="رقم الموعد" value={cancelAppointmentId} onChange={(e) => setCancelAppointmentId(e.target.value)} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                        <input placeholder="رمز التأكيد" value={cancelToken} onChange={(e) => setCancelToken(e.target.value)} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                        {showCancelConfirm ? (
                          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                            <p>هل أنت متأكد أنك تريد إلغاء هذا الموعد؟</p>
                            <div className="mt-2 flex gap-2">
                              <button type="button" onClick={() => void confirmCancellation()} disabled={cancelLoading} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{cancelLoading ? 'جارٍ الإلغاء...' : 'نعم، ألغِ الموعد'}</button>
                              <button type="button" onClick={() => setShowCancelConfirm(false)} className="rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-300">تراجع</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button type="button" onClick={handleCancelRequest} className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white">إلغاء الحجز</button>
                            {cancelError ? <p className="text-sm text-rose-300">{cancelError}</p> : null}
                          </div>
                        )}
                        <div className="mt-2">
                          <button type="button" className="text-sm text-cyan-300 underline" onClick={() => setShowReschedule((s) => !s)}>{showReschedule ? 'إخفاء إعادة الجدولة' : 'إعادة جدولة بدلاً من الإلغاء'}</button>
                          {showReschedule && (
                            <div className="mt-2 space-y-2">
                              <input placeholder="رقم الموعد" value={rescheduleAppointmentId} onChange={(e) => setRescheduleAppointmentId(e.target.value)} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                              <input placeholder="رمز التأكيد" value={rescheduleToken} onChange={(e) => setRescheduleToken(e.target.value)} className="w-full rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                              <div className="grid grid-cols-2 gap-2">
                                <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                                <input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} className="rounded-md bg-slate-800 px-3 py-2 text-slate-100" />
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={async () => {
                                  setRescheduleError(null); setRescheduleLoading(true); setRescheduleResult(null);
                                  try {
                                    const cid = publicClinicId ?? (isUuid ? clinicId : null);
                                    if (!cid) throw new Error('Unable to resolve clinic');
                                    const res = await fetch('/api/booking/reschedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinic_id: cid, appointment_id: rescheduleAppointmentId, token: rescheduleToken, date: rescheduleDate, time: rescheduleTime }) });
                                    const payload = await res.json();
                                    if (!res.ok) throw new Error(payload?.error ?? 'Reschedule failed');
                                    setRescheduleResult(payload.data ?? payload);
                                    setMessages((current) => [...current, { role: 'assistant', text: 'تم تغيير موعدك بنجاح.' }]);
                                  } catch (err: any) {
                                    setRescheduleError(err?.message ?? 'Reschedule failed');
                                  } finally { setRescheduleLoading(false); }
                                }} disabled={rescheduleLoading} className="rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{rescheduleLoading ? 'جارٍ الحجز...' : 'إعادة الجدولة'}</button>
                                {rescheduleError ? <p className="text-sm text-rose-300">{rescheduleError}</p> : null}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="rounded-b-[2rem] border-t border-slate-800 bg-slate-950/90 px-6 py-5">
        <div className="flex gap-3">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="اكتب رسالة..."
            maxLength={MAX_MESSAGE_LENGTH}
            aria-label="رسالة"
            className="min-w-0 flex-1 rounded-full border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
          <button
            type="submit"
            disabled={isSubmitting || !draft.trim()}
            className="rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'جارٍ الإرسال...' : 'إرسال'}
          </button>
        </div>
      </form>
    </div>
  );
}
