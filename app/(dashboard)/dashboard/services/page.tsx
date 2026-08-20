import DashboardSection from '@/components/dashboard/DashboardSection';
import ProviderServiceManager from '@/components/dashboard/clinic/ProviderServiceManager';

export const metadata = { title: 'Services' };

export default function ServicesPage() {
  return (
    <DashboardSection title="Services" subtitle="Manage your clinic services and pricing.">
      <ProviderServiceManager mode="services" />
    </DashboardSection>
  );
}