'use client';

import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type ChatMessage = {
  role: 'assistant' | 'user';
  text: string;
  isError?: boolean;
  isHandoff?: boolean;
};

type ClinicInfo = {
  id: string;
  name: string;
  slug: string;
};

type BookingResult = {
  appointment_id: string;
  date: string;
  time: string;
  service: string;
  provider_id: string;
  status: string;
  booking_token: string;
};

function ReceptionistForm() {
  const searchParams = useSearchParams();
  const clinicIdParam = searchParams.get('clinic_id') || undefined;
  const slugParam = searchParams.get('slug') || undefined;

  const [clinic, setClinic] = useState<ClinicInfo | null>(null);
  const [clinicError, setClinicError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [handoff, setHandoff] = useState(false);
  const [patientInfo, setPatientInfo] = useState({ name: '', phone: '' });
  const [showPatientForm, setShowPatientForm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resolve clinic from query params
  useEffect(() => {
    const params = new URLSearchParams();
    if (clinicIdParam) params.set('clinic_id', clinicIdParam);
    if (slugParam) params.set('slug', slugParam);
    const qs = params.toString();
    if (!qs) {
      setClinicError('Missing clinic identifier. Use ?clinic_id= or ?slug=');
      return;
    }
    fetch(`/api/booking/clinic?${qs}`)
      .then(async (res) => {
        if (res.status === 404) throw new Error('Clinic not found');
        if (!res.ok) throw new Error('Failed to resolve clinic');
        return res.json();
      })
      .then((body) => {
        setClinic(body.data);
        setMessages([{ role: 'assistant', text: `مرحبًا بك في ${body.data.name}! كيف يمكنني مساعدتك اليوم؟` }]);
      })
      .catch((err) => setClinicError(err instanceof Error ? err.message : 'Failed to resolve clinic'));
  }, [clinicIdParam, slugParam]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || !clinic || isSubmitting) return;

    setMessages((current) => [...current, { role: 'user', text: trimmed }]);
    setDraft('');
    setIsSubmitting(true);
    setStreamText('');

    try {
      const response = await fetch('/api/ai/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinic.id,
          conversation_id: conversationId,
          text: trimmed,
          stream: true,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const errorText = payload?.error ?? 'Unable to reach the AI service.';
        setMessages((current) => [...current, { role: 'assistant', text: errorText, isError: true }]);
        return;
      }

      // Streaming response
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') || contentType.includes('text/plain') || contentType.includes('application/octet-stream')) {
        setIsStreaming(true);
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let full = '';
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            full += decoder.decode(value, { stream: true });
            setStreamText(full);
          }
        }
        setMessages((current) => [...current, { role: 'assistant', text: full }]);
        setStreamText('');
        setIsStreaming(false);
      } else {
        // JSON response (handoff or non-streaming fallback)
        const payload = await response.json();
        if (payload?.message && typeof payload.message === 'string' && payload.message.includes('Handoff')) {
          setHandoff(true);
          setMessages((current) => [...current, { role: 'assistant', text: 'تم تحويل المحادثة إلى فريقنا. سيتواصل معك أحد أعضاء الفريق قريبًا.', isHandoff: true }]);
        } else {
          const assistantText = payload?.assistant_message?.content ?? payload?.assistant_message ?? 'تمت معالجة الرسالة.';
          setConversationId(payload?.conversation_id ?? conversationId);
          setMessages((current) => [...current, { role: 'assistant', text: assistantText }]);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      setMessages((current) => [...current, { role: 'assistant', text: 'تعذر الاتصال بالخدمة حالياً. يرجى المحاولة لاحقاً.', isError: true }]);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBooking() {
    if (!clinic || !bookingResult) return;
    // Confirm the booking via the existing confirm API
    try {
      const res = await fetch('/api/booking/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinic.id,
          appointment_id: bookingResult.appointment_id,
          token: bookingResult.booking_token,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to confirm');
      setBookingResult((prev) => prev ? { ...prev, status: 'confirmed' } : prev);
      setMessages((current) => [...current, { role: 'assistant', text: 'تم تأكيد موعدك بنجاح! 🎉' }]);
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', text: 'تعذر تأكيد الموعد. يرجى المحاولة لاحقاً.', isError: true }]);
    }
  }

  async function handleCancelBooking() {
    if (!clinic || !bookingResult) return;
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinic.id,
          appointment_id: bookingResult.appointment_id,
          token: bookingResult.booking_token,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to cancel');
      setBookingResult((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
      setMessages((current) => [...current, { role: 'assistant', text: 'تم إلغاء الموعد.' }]);
    } catch (err) {
      setMessages((current) => [...current, { role: 'assistant', text: 'تعذر إلغاء الموعد. يرجى المحاولة لاحقاً.', isError: true }]);
    }
  }

  if (clinicError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="max-w-md rounded-[2rem] border border-red-500/40 bg-red-500/10 p-8 text-center">
          <p className="text-lg font-semibold text-red-300">تعذر تحميل العيادة</p>
          <p className="mt-2 text-sm text-slate-400">{clinicError}</p>
        </div>
      </main>
    );
  }

  if (!clinic) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          جاري تحميل العيادة...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Header with clinic branding */}
      <header className="border-b border-slate-800 bg-slate-900/80 px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">AI Receptionist</p>
            <h1 className="mt-1 text-lg font-semibold text-white">{clinic.name}</h1>
          </div>
          {handoff && (
            <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
              مع فريقنا
            </span>
          )}
        </div>
      </header>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'bg-cyan-500/15 text-cyan-100'
                    : message.isError
                      ? 'bg-red-500/10 text-red-200'
                      : message.isHandoff
                        ? 'bg-amber-500/10 text-amber-200'
                        : 'bg-slate-800/80 text-slate-200'
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}

          {/* Streaming indicator */}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-3xl bg-slate-800/80 px-4 py-3 text-sm leading-6 text-slate-200">
                {streamText}
                <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-cyan-400 align-middle" />
              </div>
            </div>
          )}

          {/* Typing indicator */}
          {isSubmitting && !isStreaming && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1 rounded-3xl bg-slate-800/80 px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:0.2s]" />
              </div>
            </div>
          )}

          {/* Booking result card */}
          {bookingResult && (
            <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-sm font-semibold text-emerald-300">تفاصيل الموعد</p>
              <div className="mt-2 space-y-1 text-sm text-slate-300">
                <p>الخدمة: {bookingResult.service}</p>
                <p>التاريخ: {bookingResult.date}</p>
                <p>الوقت: {bookingResult.time}</p>
                <p>الحالة: {bookingResult.status === 'confirmed' ? 'مؤكد' : bookingResult.status === 'cancelled' ? 'ملغي' : 'قيد الانتظار'}</p>
              </div>
              <div className="mt-3 flex gap-2">
                {bookingResult.status === 'tentative' && (
                  <button onClick={handleBooking} className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400">
                    تأكيد الموعد
                  </button>
                )}
                {bookingResult.status !== 'cancelled' && (
                  <button onClick={handleCancelBooking} className="rounded-full border border-red-500/50 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10">
                    إلغاء الموعد
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Patient info form */}
          {showPatientForm && (
            <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4">
              <p className="text-sm font-semibold text-white">بياناتك</p>
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  value={patientInfo.name}
                  onChange={(e) => setPatientInfo((p) => ({ ...p, name: e.target.value }))}
                  placeholder="الاسم الكامل"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <input
                  type="tel"
                  value={patientInfo.phone}
                  onChange={(e) => setPatientInfo((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="رقم الهاتف"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500"
                />
                <button
                  onClick={() => setShowPatientForm(false)}
                  className="w-full rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                >
                  حفظ
                </button>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <footer className="border-t border-slate-800 bg-slate-900/80 px-4 py-4">
        <div className="mx-auto max-w-2xl">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="اكتب رسالتك..."
              disabled={isSubmitting}
              className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isSubmitting || !draft.trim()}
              className="rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              إرسال
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-slate-500">
            {clinic.name} — AI Receptionist
          </p>
        </div>
      </footer>
    </main>
  );
}

export default function ReceptionistPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
          جاري التحميل...
        </div>
      </main>
    }>
      <ReceptionistForm />
    </Suspense>
  );
}