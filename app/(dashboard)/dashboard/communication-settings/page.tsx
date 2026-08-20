import DashboardSection from '@/components/dashboard/DashboardSection';
import CommunicationSettingsForm from '@/components/dashboard/communication/CommunicationSettingsForm';

export const metadata = {
  title: 'إعدادات التواصل',
};

export default function CommunicationSettingsPage() {
  return (
    <DashboardSection
      title="إعدادات التواصل"
      subtitle="تحكم في قنوات الإشعارات (بريد، SMS، واتساب، تيليجرام) لكل نوع من أنواع الإشعارات."
    >
      <CommunicationSettingsForm />
    </DashboardSection>
  );
}