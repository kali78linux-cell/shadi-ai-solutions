'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import DashboardSection from '@/components/dashboard/DashboardSection';
import StatusPill from '@/components/dashboard/StatusPill';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';
import { dashboardStatus, formatRelativeTime } from '@/lib/i18n';

/**
 * CONVERSATION SESSION CONTROL CENTER (staff view).
 *
 * One screen answering everything a receptionist needs before taking over:
 * who is on the chat (or "زائر جديد"), what the AI understood, the full
 * transcript, any linked appointment, and the staff actions.
 *
 * Concepts stay separate: this page shows a Conversation SESSION — the
 * Patient record and Appointment are linked, not conflated. All data is
 * fetched from membership-guarded APIs; nothing here trusts client ids.
 */

type Summary = {
  display_name: string | null;
  is_known_visitor: boolean;
  phone: string | null;
  patient_id: string | null;
  problem_summary: string | null;
  urgency: string | null;
  recommended_service: string | null;
  recommended_provider: string | null;
  last_message_at: string | null;
  updated_at: string | null;
  needs_attention: boolean;
};

type AppointmentInfo = {
  id: string;
  service: string | null;
  appointment_date: string | null;
  scheduled_at: string | null;
  status: string | null;
  provider_name: string | null;
};

type PatientInfo = { id: string; name: string | null; phone: string | null; email: string | null };

type Message = { id: string; role: string; content: string | null; created_at: string | null };

const ROLE_LABELS: Record<string, string> = {
  patient: 'المريض',
  assistant: 'المساعد الذكي',
  staff: 'موظف العيادة',
  system: 'النظام',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/70 py-2 last:border-none">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className="text-right text-sm text-slate-100">{value ?? <span className="text-slate-500">—</span>}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
      <h3 className="mb-3 text-base font-semibold text-cyan-200">{title}</h3>
      {children}
    </section>
  );
}

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params?.id;
  const { clinicId, clinicSlug, authHeaders, loading: clinicLoading } = useClinicContext();

  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('open');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [appointment, setAppointment] = useState<AppointmentInfo | null>(null);
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId || clinicLoading) return;
    let cancelled = false;

    async function loadAll() {
      setPageLoading(true);
      setError(null);
      try {
        const headers = await authHeaders();
        // Core payload: conversation + enriched summary + linked appointment + patient.
        const detailRes = await fetch(`/api/ai/conversations?id=${encodeURIComponent(conversationId!)}`, { headers });
        if (detailRes.status === 404) throw new Error('المحادثة غير موجودة');
        if (detailRes.status === 403) throw new Error('لا تملك صلاحية الوصول لهذه المحادثة');
        if (!detailRes.ok) throw new Error('تعذر تحميل المحادثة');
        const detail = await detailRes.json();
        if (cancelled) return;
        setStatus(detail?.data?.status ?? 'open');
        setSessionId(detail?.data?.session_id ?? null);
        setStartedAt(detail?.data?.started_at ?? detail?.data?.created_at ?? null);
        setSummary(detail?.summary ?? null);
        setAppointment(detail?.appointment ?? null);
        setPatient(detail?.patient ?? null);

        // Transcript (same membership-guarded endpoint used by chat restore).
        if (clinicId) {
          const messagesRes = await fetch(
            `/api/ai/messages?conversation_id=${encodeURIComponent(conversationId!)}&clinic_id=${encodeURIComponent(clinicId)}`,
            { headers }
          );
          if (messagesRes.ok) {
            const messagesPayload = await messagesRes.json();
            if (!cancelled) setMessages(Array.isArray(messagesPayload?.data) ? messagesPayload.data : []);
          }
        }
      } catch (caughtError) {
        if (!cancelled) setError(caughtError instanceof Error ? caughtError.message : 'خطأ غير معروف');
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, clinicId, clinicLoading]);

  async function changeStatus(nextStatus: 'open' | 'awaiting_human' | 'closed') {
    setActionBusy(true);
    setActionError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/ai/conversations', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conversationId, status: nextStatus }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? 'فشل تحديث الحالة');
      }
      setStatus(nextStatus);
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : 'خطأ غير معروف');
    } finally {
      setActionBusy(false);
    }
  }
  const identityName = summary?.is_known_visitor ? summary.display_name : 'زائر جديد';

  if (pageLoading) {
    return (
      <DashboardSection title="تفاصيل المحادثة" subtitle="جارٍ التحميل…">
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      </DashboardSection>
    );
  }

  if (error) {
    return (
      <DashboardSection title="تفاصيل المحادثة">
        <div className="rounded-[1.5rem] border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">{error}</div>
        <Link
          href={clinicSlug ? `/dashboard/${encodeURIComponent(clinicSlug)}/conversations` : '/dashboard/conversations'}
          className="mt-4 inline-block text-sm text-cyan-300 hover:underline"
        >← رجوع إلى كل المحادثات</Link>
      </DashboardSection>
    );
  }

  return (
    <DashboardSection title={identityName} subtitle={`جلسة محادثة · بدأت ${formatRelativeTime(startedAt)}${summary?.last_message_at ? ` · آخر نشاط ${formatRelativeTime(summary.last_message_at)}` : ''}`}>
      <div className="space-y-6">
        {/* Header row: back, status, session id (technical detail only) */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={clinicSlug ? `/dashboard/${encodeURIComponent(clinicSlug)}/conversations` : '/dashboard/conversations'}
            className="text-sm text-cyan-300 hover:underline"
          >← كل المحادثات</Link>
          <StatusPill tone={status === 'closed' ? 'success' : status === 'awaiting_human' ? 'warning' : 'neutral'}>
            {dashboardStatus(status)}
          </StatusPill>
          {sessionId && (
            <span className="font-mono text-xs text-slate-500" dir="ltr">{sessionId}</span>
          )}
        </div>

        {/* Staff actions */}
        <section className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="mb-3 text-base font-semibold text-cyan-200">إجراءات الموظف</h3>
          {actionError && <p className="mb-2 text-sm text-red-300">{actionError}</p>}
          <div className="flex flex-wrap gap-2">
            {status !== 'awaiting_human' && (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => changeStatus('awaiting_human')}
                className="rounded-full border border-amber-500/50 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                تحويل لموظف
              </button>
            )}
            {status !== 'closed' ? (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => changeStatus('closed')}
                className="rounded-full border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-100 transition hover:bg-slate-700 disabled:opacity-50"
              >
                إغلاق المحادثة
              </button>
            ) : (
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => changeStatus('open')}
                className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                إعادة فتح المحادثة
              </button>
            )}
            {patient && (
              <Link
                href="/dashboard/patients"
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/20"
              >
                فتح ملف المريض ↗
              </Link>
            )}
            {appointment && (
              <Link
                href="/dashboard/appointments"
                className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/20"
              >
                فتح الموعد ↗
              </Link>
            )}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Patient section */}
          <SectionCard title="المريض">
            {summary?.is_known_visitor || patient ? (
              <>
                <InfoRow label="الاسم" value={summary?.display_name ?? patient?.name ?? null} />
                <InfoRow label="الهاتف" value={summary?.phone ?? patient?.phone ?? null} />
                <InfoRow label="البريد الإلكتروني" value={patient?.email ?? null} />
                <InfoRow label="معرّف المريض" value={patient?.id ? <span className="font-mono text-xs" dir="ltr">{patient.id}</span> : null} />
              </>
            ) : (
              <p className="text-sm text-slate-400">زائر جديد — لم يشارك بيانات هويته بعد. لا يوجد سجل مريض مرتبط.</p>
            )}
          </SectionCard>

          {/* AI Summary section */}
          <SectionCard title="ملخص الذكاء الاصطناعي">
            {summary && (summary.problem_summary || summary.recommended_service || summary.recommended_provider || summary.urgency) ? (
              <>
                <InfoRow label="المشكلة" value={summary.problem_summary} />
                <InfoRow label="درجة الإلحاح" value={summary.urgency} />
                <InfoRow label="الخدمة المقترحة" value={summary.recommended_service} />
                <InfoRow label="الطبيب المقترح" value={summary.recommended_provider} />
              </>
            ) : (
              <p className="text-sm text-slate-400">لا يوجد تحليل بعد — لم يوضح الزائر طلبه حتى الآن.</p>
            )}
          </SectionCard>
        </div>
        {/* Appointment section */}
        <SectionCard title="الموعد">
          {appointment ? (
            <>
              <InfoRow label="رقم الحجز" value={<span className="font-mono text-xs" dir="ltr">{appointment.id}</span>} />
              <InfoRow label="الخدمة" value={appointment.service} />
              <InfoRow label="الطبيب" value={appointment.provider_name} />
              <InfoRow label="التاريخ" value={appointment.appointment_date} />
              <InfoRow label="الوقت" value={appointment.scheduled_at} />
              <InfoRow label="الحالة" value={appointment.status ? dashboardStatus(appointment.status) : null} />
            </>
          ) : (
            <p className="text-sm text-slate-400">لا يوجد حجز حتى الآن.</p>
          )}
        </SectionCard>

        {/* Conversation transcript */}
        <SectionCard title={`سجل المحادثة (${messages.length})`}>
          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد رسائل محفوظة لهذه الجلسة.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`rounded-2xl border p-3 ${
                    message.role === 'patient'
                      ? 'border-cyan-500/20 bg-cyan-500/5'
                      : message.role === 'staff'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-slate-800 bg-slate-900/50'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-300">{ROLE_LABELS[message.role] ?? message.role}</span>
                    <span className="text-xs text-slate-500">{formatRelativeTime(message.created_at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-100">{message.content}</p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </DashboardSection>
  );
}

