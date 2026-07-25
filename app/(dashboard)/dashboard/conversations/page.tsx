'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import StatusPill from '@/components/dashboard/StatusPill';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { isSupabaseConfigured } from '@/lib/supabase';

type ConversationRecord = {
  id: string;
  patient_id?: string | null;
  session_id?: string | null;
  status?: 'open' | 'awaiting_human' | 'closed';
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadConversations() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/ai/conversations?clinic_id=00000000-0000-0000-0000-000000000000');
        if (!response.ok) {
          throw new Error('Conversation API unavailable');
        }
        const payload = await response.json();
        if (isMounted) {
          setConversations(Array.isArray(payload?.data) ? payload.data : []);
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : 'Unknown error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadConversations();
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;

    return conversations.filter((conversation) => [conversation.patient_id ?? '', conversation.session_id ?? '', conversation.status ?? ''].some((value) => value.toLowerCase().includes(normalized)));
  }, [conversations, query]);

  return (
    <DashboardSection title="AI Conversations" subtitle="Live conversations, takeover controls, search, and timeline context.">
      <div className="mb-5 rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-4">
        <label htmlFor="conversation-search" className="text-sm text-slate-400">Search conversations</label>
        <input
          id="conversation-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search session, patient or status"
          className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : !isSupabaseConfigured ? (
        <EmptyState title="Supabase is not configured" description="Connect the clinic environment to load live conversation activity from the backend." />
      ) : error ? (
        <EmptyState title="Conversation service unavailable" description={error} />
      ) : filteredConversations.length === 0 ? (
        <EmptyState title="No conversations available" description="Messages will appear here as patients interact with the AI receptionist." />
      ) : (
        <div className="space-y-4">
          {filteredConversations.slice(0, 5).map((conversation) => (
            <div key={conversation.id} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-lg font-semibold text-white">{conversation.patient_id ?? 'Patient session'}</p>
                  <p className="text-sm text-slate-400">{conversation.session_id ?? 'Live session'}</p>
                </div>
                <StatusPill tone={conversation.status === 'closed' ? 'success' : conversation.status === 'awaiting_human' ? 'warning' : 'neutral'}>{conversation.status ?? 'open'}</StatusPill>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardSection>
  );
}
