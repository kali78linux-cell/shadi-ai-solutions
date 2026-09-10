import DashboardSection from '@/components/dashboard/DashboardSection';
import PublicPageContentManager from '@/components/dashboard/clinic/PublicPageContentManager';

export const metadata = { title: 'محتوى الصفحة العامة' };

export default function PublicContentPage() {
  return (
    <DashboardSection
      title="محتوى الصفحة العامة"
      subtitle="المظهر العام، الإنجازات، شهادات المرضى، المقالات، وشريط الأخبار — كل ما يظهر لزوار صفحتك العامة."
    >
      <PublicPageContentManager />
    </DashboardSection>
  );
}
