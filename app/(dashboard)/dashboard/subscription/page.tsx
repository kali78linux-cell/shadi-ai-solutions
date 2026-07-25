import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';

export default function SubscriptionPage() {
  return (
    <DashboardSection title="Subscription" subtitle="Current plan, usage, billing, and operational limits.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Current plan</p>
          <p className="mt-2 text-2xl font-semibold text-white">Growth</p>
        </div>
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Usage</p>
          <p className="mt-2 text-2xl font-semibold text-white">78 / 100</p>
        </div>
      </div>
      <div className="mt-5">
        <EmptyState title="Billing details are API-backed" description="The subscription and usage information should be supplied from the clinic billing backend for production data." />
      </div>
    </DashboardSection>
  );
}
