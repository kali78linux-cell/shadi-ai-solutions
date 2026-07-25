'use client';

import MetricCard from '@/components/dashboard/MetricCard';
import { FileText, DatabaseZap, AlertTriangle } from 'lucide-react';
import type { Document } from './KnowledgeBaseManager'; // We'll define this type soon

type StatCardsProps = {
  documents: Document[];
  isLoading: boolean;
};

export function StatCards({ documents, isLoading }: StatCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard title="إجمالي المستندات" value="..." icon={<FileText />} />
        <MetricCard title="إجمالي القطع (Chunks)" value="..." tone="emerald" icon={<DatabaseZap />} />
        <MetricCard title="تحتاج للمراجعة" value="..." tone="amber" icon={<AlertTriangle />} />
      </div>
    );
  }

  const totalDocs = documents.length;
  const totalChunks = documents.reduce((acc, doc) => acc + (doc.chunk_count || 0), 0);
  const errorDocs = documents.filter(d => d.processing_status === 'error').length;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <MetricCard
        title="إجمالي المستندات"
        value={totalDocs.toLocaleString('ar-SA')}
        icon={<FileText className="text-cyan-300" />}
        tone="cyan"
        detail="إجمالي عدد المستندات في قاعدة المعرفة"
      />
      <MetricCard
        title="إجمالي القطع (Chunks)"
        value={totalChunks.toLocaleString('ar-SA')}
        icon={<DatabaseZap className="text-emerald-300" />}
        tone="emerald"
        detail="إجمالي القطع المفهرسة للبحث"
      />
      <MetricCard
        title="تحتاج للمراجعة"
        value={errorDocs.toLocaleString('ar-SA')}
        icon={<AlertTriangle className="text-amber-300" />}
        tone="amber"
        detail="المستندات التي فشلت معالجتها"
      />
    </div>
  );
}
