import Skeleton from '@/components/ui/Skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="جارٍ تحميل لوحة التحكم">
      <div className="h-10 w-52 rounded-full bg-slate-800/70" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <div className="h-64 rounded-[2rem] border border-slate-800 bg-slate-950/70" />
    </div>
  );
}