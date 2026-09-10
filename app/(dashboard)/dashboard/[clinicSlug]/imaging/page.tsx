import DashboardSection from '@/components/dashboard/DashboardSection';
import ActivityOperations from '@/components/dashboard/clinic/ActivityOperations';

export const metadata = { title: 'مركز الأشعة / التصوير' };

/**
 * Digital Healthcare Space — Imaging Center dashboard (Phase D).
 * Domain-specific operations screen for imaging centers. Reuses the shared
 * dashboard chrome (header/nav/RBAC) and exposes additive imaging domain data.
 */
export default function ImagingDashboardPage() {
  return (
    <DashboardSection
      title="مركز الأشعة / التصوير"
      subtitle="إدارة خدمات التصوير وطلبات الفحص المسجلة لدى المركز."
    >
      <ActivityOperations activityType="imaging_center" />
    </DashboardSection>
  );
}