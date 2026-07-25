import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';

const team = [
  { name: 'Shadi Suad', role: 'Clinic Admin', permissions: 'Full access' },
  { name: 'Reception Team', role: 'Front Desk', permissions: 'Appointments + Leads' },
  { name: 'AI Coordinator', role: 'Operations', permissions: 'Conversations + Rules' },
];

export default function TeamPage() {
  return (
    <DashboardSection title="Team Management" subtitle="Review staff, roles, and access levels across the clinic workspace.">
      <div className="grid gap-4 md:grid-cols-3">
        {team.map((member) => (
          <article key={member.name} className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
            <p className="text-lg font-semibold text-white">{member.name}</p>
            <p className="mt-2 text-sm text-cyan-300">{member.role}</p>
            <p className="mt-4 text-sm text-slate-400">{member.permissions}</p>
          </article>
        ))}
      </div>
      <div className="mt-5">
        <EmptyState title="Permission model is configured server-side" description="This section can be connected directly to the staff and clinic role APIs once the clinic account is available." />
      </div>
    </DashboardSection>
  );
}
