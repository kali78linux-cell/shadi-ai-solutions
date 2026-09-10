import DashboardSection from '@/components/dashboard/DashboardSection';
import ActivityOperations from '@/components/dashboard/clinic/ActivityOperations';

export const metadata = { title: 'مختبر الأسنان' };

/**
 * Digital Healthcare Space — Dental Lab dashboard (Phase D).
 * Domain-specific operations screen for dental labs. Reuses the shared
 * dashboard chrome (header/nav/RBAC) and exposes additive lab domain data.
 */
export default function DentalLabDashboardPage() {
  return (
    <DashboardSection
      title="مختبر الأسنان"
      subtitle="إدارة خدمات المختبر والحالات الواردة من العيادات."
    >
      <ActivityOperations activityType="dental_lab" />
    </DashboardSection>
  );
}