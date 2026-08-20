import DashboardSection from '@/components/dashboard/DashboardSection';
import NotificationTemplateManager from '@/components/dashboard/NotificationTemplateManager';

export const metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <DashboardSection title="Notifications" subtitle="Manage notification templates and communication settings.">
      <NotificationTemplateManager />
    </DashboardSection>
  );
}
