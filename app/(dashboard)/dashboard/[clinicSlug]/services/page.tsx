import DashboardSection from '@/components/dashboard/DashboardSection';
import ProviderServiceManager from '@/components/dashboard/clinic/ProviderServiceManager';

export const metadata = { title: 'الخدمات' };

export default function ServicesPage() {
  return (
    <DashboardSection title="الخدمات" subtitle="أدر خدمات العيادة وأسعارها.">
      <ProviderServiceManager mode="services" />
    </DashboardSection>
  );
}
