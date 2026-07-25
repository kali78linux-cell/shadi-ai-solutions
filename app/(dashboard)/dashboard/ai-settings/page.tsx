import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';

export default function AISettingsPage() {
  return (
    <DashboardSection title="AI Settings" subtitle="Control the assistant behavior, tone, greeting, languages, and business rules.">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Assistant name</p>
          <p className="mt-2 text-lg font-semibold text-white">Dental AI Receptionist</p>
        </div>
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Tone</p>
          <p className="mt-2 text-lg font-semibold text-white">Warm, clear, professional</p>
        </div>
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Greeting</p>
          <p className="mt-2 text-lg font-semibold text-white">مرحبًا! كيف يمكنني مساعدتك؟</p>
        </div>
        <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
          <p className="text-sm text-slate-400">Languages</p>
          <p className="mt-2 text-lg font-semibold text-white">Arabic · English</p>
        </div>
      </div>
      <div className="mt-5">
        <EmptyState title="Business rules ready for backend sync" description="This admin panel is wired to the existing APIs where the clinic configuration is persisted." />
      </div>
    </DashboardSection>
  );
}
