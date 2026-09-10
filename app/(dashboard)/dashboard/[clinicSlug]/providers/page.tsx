import DashboardSection from '@/components/dashboard/DashboardSection';
import ProviderServiceManager from '@/components/dashboard/clinic/ProviderServiceManager';
import ProviderScheduleManager from '@/components/dashboard/clinic/ProviderScheduleManager';
import PublicPresenceManager from '@/components/dashboard/clinic/PublicPresenceManager';

export const metadata = { title: 'مقدمو الخدمة' };

export default function ProvidersPage() {
  return (
    <DashboardSection title="مقدمو الخدمة" subtitle="أدر أطباء العيادة وساعات العمل والخدمات.">
      <ProviderServiceManager mode="providers" />
      <div className="mt-8">
        <ProviderScheduleManager />
      </div>
      <div className="mt-8">
        <PublicPresenceManager />
      </div>
    </DashboardSection>
  );
}
