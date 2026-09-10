import DashboardSection from '@/components/dashboard/DashboardSection';
import NotificationTemplateManager from '@/components/dashboard/NotificationTemplateManager';

export const metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return (
    <DashboardSection title="الإشعارات" subtitle="أدر قوالب الإشعارات وإعدادات التواصل.">
      <NotificationTemplateManager />
    </DashboardSection>
  );
}
