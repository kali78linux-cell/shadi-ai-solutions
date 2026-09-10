import DashboardSection from '@/components/dashboard/DashboardSection';
import ClinicSetupManager from '@/components/dashboard/clinic/ClinicSetupManager';

export const metadata = { title: 'Clinic Setup' };

export default function ClinicSetupPage() {
  return (
    <DashboardSection title="إعداد العيادة" subtitle="أكمل بيانات عيادتك وتابع جاهزيتها للحجز العام.">
      <ClinicSetupManager />
    </DashboardSection>
  );
}
