import DashboardSection from '@/components/dashboard/DashboardSection';
import PublicPageManager from '@/components/dashboard/clinic/PublicPageManager';

export const metadata = { title: 'الصفحة العامة للعيادة' };

export default function PublicPagePage() {
  return (
    <DashboardSection
      title="الصفحة العامة"
      subtitle="تحكم في شكل ومحتوى صفحتك العامة التي يراها المرضى وروّاد الأعمال قبل الحجز."
    >
      <PublicPageManager />
    </DashboardSection>
  );
}
