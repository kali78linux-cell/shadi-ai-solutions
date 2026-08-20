'use client';

import { useMemo } from 'react';
import { ClinicKnowledgeDocument } from '@/types/db';

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function StatCards({ documents, isLoading }: { documents: ClinicKnowledgeDocument[]; isLoading?: boolean }) {
  const stats = useMemo(() => {
    const total = documents.length;
    const indexed = documents.filter(d => d.processing_status === 'indexed').length;
    const processing = documents.filter(d => ['pending', 'processing', 'chunking', 'embedding'].includes(d.processing_status)).length;
    const failed = documents.filter(d => d.processing_status === 'error').length;
    const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0);
    const totalSize = documents.reduce((sum, doc) => sum + doc.file_size, 0);

    return { total, indexed, processing, failed, totalChunks, totalSize };
  }, [documents]);

  const statItems = [
    { label: 'Total Documents', value: stats.total },
    { label: 'Indexed', value: stats.indexed },
    { label: 'Processing', value: stats.processing },
    { label: 'Failed', value: stats.failed },
    { label: 'Total Chunks', value: stats.totalChunks },
    { label: 'Total Storage', value: formatBytes(stats.totalSize) },
  ];

  if (isLoading) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {statItems.map(item => (
        <div key={item.label} className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <p className="text-sm text-slate-400">{item.label}</p>
          <p className="text-2xl font-semibold text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}