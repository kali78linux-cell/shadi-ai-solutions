'use client';

import { useEffect, useMemo, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import Skeleton from '@/components/ui/Skeleton';
import { isSupabaseConfigured } from '@/lib/supabase';

type AnalyticsPayload = {
  appointmentsToday?: number;
  completionRate?: number;
  cancellationRate?: number;
  noShowRate?: number;
  averageBookingDelayMinutes?: number;
  providerUtilization?: Record<string, number>;
};

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadAnalytics() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/appointments/analytics?clinic_id=00000000-0000-0000-0000-000000000000');
        if (!response.ok) {
          throw new Error('Analytics API unavailable');
        }
        const payload = await response.json();
        if (isMounted) {
          setData(payload?.data ?? null);
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

    loadAnalytics();
    return () => {
      isMounted = false;
    };
  }, []);

  const bars = useMemo(() => {
    const providers = data?.providerUtilization ?? {};
    return Object.entries(providers).map(([provider, value]) => ({ provider, value }));
  }, [data]);

  return (
    <div className="space-y-6">
      <DashboardSection title="Analytics" subtitle="Live conversion, AI usage, and booking efficiency metrics from the backend analytics endpoint.">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : !isSupabaseConfigured ? (
          <EmptyState title="Supabase is not configured" description="Backend analytics are unavailable until the clinic environment is linked." />
        ) : error ? (
          <EmptyState title="Analytics service unavailable" description={error} />
        ) : data ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <p className="text-sm text-slate-400">Appointments today</p>
                <p className="mt-2 text-2xl font-semibold text-white">{data.appointmentsToday ?? 0}</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <p className="text-sm text-slate-400">Completion rate</p>
                <p className="mt-2 text-2xl font-semibold text-white">{Math.round((data.completionRate ?? 0) * 100)}%</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <p className="text-sm text-slate-400">Cancellation rate</p>
                <p className="mt-2 text-2xl font-semibold text-white">{Math.round((data.cancellationRate ?? 0) * 100)}%</p>
              </div>
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <p className="text-sm text-slate-400">Average booking delay</p>
                <p className="mt-2 text-2xl font-semibold text-white">{Math.round(data.averageBookingDelayMinutes ?? 0)}m</p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <p className="text-sm font-semibold text-white">Provider utilization</p>
              <div className="mt-4 space-y-4">
                {bars.map((item) => (
                  <div key={item.provider}>
                    <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                      <span>{item.provider}</span>
                      <span>{item.value}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-900">
                      <div className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: `${Math.min((item.value / Math.max(...bars.map((entry) => entry.value), 1)) * 100, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </DashboardSection>
    </div>
  );
}
