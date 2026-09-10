'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import DashboardSection from '@/components/dashboard/DashboardSection';
import StatusPill from '@/components/dashboard/StatusPill';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { useClinicContext } from '@/lib/useClinicContext';
import { dashboardStatus, formatRelativeTime } from '@/lib/i18n';

/**
 * Staff conversation inbox rendering ENRICHED ConversationSummaries
 * (built server-side by /api/ai/conversations): real identity or "زائر جديد",
 * problem summary, urgency, booking linkage and last activity — raw session
 * ids are demoted to tertiary detail. Each row opens the session control
 * center at /dashboard/conversations/[id].
 */

type BookingInfo = {
  id: string;
  service: string | null;
  appointment_date: string | null;
  scheduled_at: string | null;
  status: string | null;
  provider_name: string | null;
};

type ConversationSummary = {
  id: string;
  session_id: string;
  status: string;
  started_at?: string | null;
  updated_at?: string | null;
  display_name: string | null;
  is_known_visitor: boolean;
  phone: string | null;
  patient_id: string | null;
  problem_summary: string | null;
  urgency: string | null;
  recommended_service: string | null;
  recommended_provider: string | null;
  has_booking: boolean;
  booking: BookingInfo | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  needs_attention: boolean;
};

const URGENCY_LABELS: Record<string, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عاجل',
  critical: 'طارئ',
};

function UrgencyBadge({ urgency }: { urgency: string | null }) {
  if (!urgency || !URGENCY_LABELS[urgency]) return null;
  const label = `${urgency === 'critical' ? '🚨 ' : ''}${URGENCY_LABELS[urgency]}`;
  return (
    <StatusPill tone={urgency === 'critical' ? 'danger' : urgency === 'high' ? 'warning' : 'neutral'}>
      {label}
    </StatusPill>
  );
}

function BookingBadge({ booking }: { booking: BookingInfo }) {
  const statusLabel =
    booking.status === 'cancelled' ? 'حجز ملغى' : booking.status === 'completed' ? 'حجز مكتمل' : 'حجز مرتبط';
  const label = `✓ ${statusLabel}${booking.service ? ` · ${booking.service}` : ''}`;
  return (
    <StatusPill tone={booking.status === 'cancelled' ? 'warning' : 'success'}>
      {label}
    </StatusPill>
  );
}

export default function ConversationsPage() {
  const { clinicId, authHeaders, loading: clinicLoading, error: clinicError } = useClinicContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  async function loadConversations(id: string) {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/ai/conversations?clinic_id=${encodeURIComponent(id)}`, { headers });
      if (!response.ok) throw new Error('Conversation API unavailable');
      const payload = await response.json();
      setConversations(Array.isArray(payload?.data) ? payload.data : []);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (clinicLoading) {
      setLoading(true);
      return;
    }
    if (!clinicId) {
      if (clinicError) setError(clinicError);
      setLoading(false);
      return;
    }
    void loadConversations(clinicId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicLoading, clinicId]);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((conversation) =>
      [
        conversation.display_name ?? '',
        conversation.phone ?? '',
        conversation.problem_summary ?? '',
        conversation.recommended_service ?? '',
        conversation.session_id ?? '',
        conversation.status ?? '',
      ].some((value) => value.toLowerCase().includes(normalized))
    );
  }, [conversations, query]);

  // Staff triage order: handoffs first, then newest activity.
  const sortedConversations = useMemo(
    () =>
      [...filteredConversations].sort((a, b) => {
        if (a.needs_attention !== b.needs_attention) return a.needs_attention ? -1 : 1;
        const ta = new Date(a.last_message_at ?? a.updated_at ?? a.started_at ?? 0).getTime();
        const tb = new Date(b.last_message_at ?? b.updated_at ?? b.started_at ?? 0).getTime();
        return tb - ta;
      }),
    [filteredConversations]
  );

  return (
    <DashboardSection title="محادثات الذكاء الاصطناعي" subtitle="محادثات مباشرة، وتحكم بالتحويل، وبحث وسجل زمني.">
      <div className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
        <label htmlFor="conversation-search" className="text-sm text-slate-400">البحث في المحادثات</label>
        <input
          id="conversation-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو المشكلة أو الحالة"
          className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : error ? (
        <EmptyState title="خدمة المحادثات غير متاحة" description={error} />
      ) : sortedConversations.length === 0 ? (
        <EmptyState title="لا توجد محادثات" description="ستظهر الرسائل هنا عندما يتفاعل المرضى مع موظف الاستقبال الذكي." />
      ) : (
        <div className="space-y-4">
          {sortedConversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/dashboard/conversations/${conversation.id}`}
              className={`block rounded-[1.5rem] border bg-slate-950/70 p-5 transition hover:border-cyan-500/60 hover:bg-slate-900/70 ${
                conversation.needs_attention ? 'border-amber-500/50' : 'border-slate-800'
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  {/* Identity line: real name when known, otherwise زائر جديد */}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-semibold text-white">
                      {conversation.is_known_visitor ? conversation.display_name : 'زائر جديد'}
                    </p>
                    <UrgencyBadge urgency={conversation.urgency} />
                    {conversation.has_booking && conversation.booking && (
                      <BookingBadge booking={conversation.booking} />
                    )}
                  </div>

                  {/* Context lines */}
                  <p className="mt-1 truncate text-sm text-slate-300">
                    {conversation.problem_summary ?? 'لم تُذكر المشكلة بعد'}
                    {conversation.recommended_service ? ` · ${conversation.recommended_service}` : ''}
                    {conversation.recommended_provider ? ` · ${conversation.recommended_provider}` : ''}
                  </p>
                  {(conversation.phone || conversation.last_message_preview) && (
                    <p className="mt-1 truncate text-sm text-slate-400">
                      {conversation.phone ? `📞 ${conversation.phone} · ` : ''}
                      {conversation.last_message_preview ?? ''}
                    </p>
                  )}

                  {/* Session id demoted to tertiary technical detail */}
                  {!conversation.is_known_visitor && (
                    <p className="mt-1 font-mono text-xs text-slate-500" dir="ltr">{conversation.session_id}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <StatusPill tone={conversation.status === 'closed' ? 'success' : conversation.status === 'awaiting_human' ? 'warning' : 'neutral'}>
                    {dashboardStatus(conversation.status ?? 'open')}
                  </StatusPill>
                  <p className="text-xs text-slate-500">
                    آخر نشاط: {formatRelativeTime(conversation.last_message_at ?? conversation.updated_at)}
                  </p>
                  <span className="text-xs font-medium text-cyan-300">فتح المحادثة ←</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}
