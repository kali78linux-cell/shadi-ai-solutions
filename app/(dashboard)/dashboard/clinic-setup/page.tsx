import DashboardSection from '@/components/dashboard/DashboardSection';
import ClinicSetupManager from '@/components/dashboard/clinic/ClinicSetupManager';

export const metadata = { title: 'Clinic Setup' };

export default function ClinicSetupPage() {
  return (
    <DashboardSection title="Clinic Setup" subtitle="Complete your clinic profile and track readiness for public booking.">
      <ClinicSetupManager />
    </DashboardSection>
  );
}