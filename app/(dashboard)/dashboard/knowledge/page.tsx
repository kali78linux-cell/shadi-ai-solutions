import DashboardSection from '@/components/dashboard/DashboardSection';
import KnowledgeBaseManager from '@/components/dashboard/knowledge/KnowledgeBaseManager';

export const metadata = {
  title: 'إدارة قاعدة المعرفة',
};

export default function KnowledgeBasePage() {
  return (
    <DashboardSection
      title="إدارة قاعدة المعرفة"
      subtitle="أضف، حدث، وحلل مصادر المعرفة المستخدمة بواسطة المساعد الذكي."
    >
      <KnowledgeBaseManager />
    </DashboardSection>
  );
}
