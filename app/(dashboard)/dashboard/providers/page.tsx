import DashboardSection from '@/components/dashboard/DashboardSection';
import ProviderServiceManager from '@/components/dashboard/clinic/ProviderServiceManager';
import ProviderScheduleManager from '@/components/dashboard/clinic/ProviderScheduleManager';

export const metadata = { title: 'Providers' };

export default function ProvidersPage() {
  return (
    <DashboardSection title="Providers" subtitle="Manage your clinic dentists, working hours, and services.">
      <ProviderServiceManager mode="providers" />
      <div className="mt-8">
        <ProviderScheduleManager />
      </div>
    </DashboardSection>
  );
}