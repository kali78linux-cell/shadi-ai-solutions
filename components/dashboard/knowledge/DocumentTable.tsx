'use client';

import type { ClinicKnowledgeDocument } from '@/types/db';
import StatusPill from '@/components/dashboard/StatusPill';
import { FileText, FileCode, FileJson, MoreVertical } from 'lucide-react';
import { format } from 'date-fns';
import { arSA } from 'date-fns/locale';

type DocumentTableProps = {
  documents: ClinicKnowledgeDocument[];
};

const getFileIcon = (fileType: string) => {
  switch (fileType) {
    case 'pdf': return <FileText className="text-rose-400" />;
    case 'docx': return <FileText className="text-blue-400" />;
    case 'txt': return <FileCode className="text-slate-400" />;
    default: return <FileJson className="text-amber-400" />;
  }
};

const getStatusPill = (status: ClinicKnowledgeDocument['processing_status']) => {
  switch (status) {
    case 'indexed':
      return <StatusPill tone="success">مفهرس</StatusPill>;
    case 'processing':
      return <StatusPill tone="warning">قيد المعالجة</StatusPill>;
    case 'error':
      return <StatusPill tone="danger">خطأ</StatusPill>;
    default:
      return <StatusPill tone="neutral">معلق</StatusPill>;
  }
};

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export function DocumentTable({ documents }: DocumentTableProps) {
  if (documents.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200">لم يتم العثور على مستندات</h3>
        <p className="mt-1">حاول تعديل البحث أو قم برفع مستند جديد.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-right">
        <thead className="bg-slate-50 dark:bg-slate-900/40">
          <tr>
            <th scope="col" className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">اسم الملف</th>
            <th scope="col" className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">الحالة</th>
            <th scope="col" className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">تاريخ الرفع</th>
            <th scope="col" className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">الحجم / القطع</th>
            <th scope="col" className="relative px-6 py-3">
              <span className="sr-only">الإجراءات</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-950">
          {documents.map((doc) => (
            <tr key={doc.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">{getFileIcon(doc.file_type)}</div>
                  <div>
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-50">{doc.original_filename}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">رفع بواسطة: {doc.uploaded_by || 'غير معروف'}</div>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">{getStatusPill(doc.processing_status)}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                {format(new Date(doc.created_at), 'd MMMM yyyy', { locale: arSA })}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 dark:text-slate-400">
                <div>{formatBytes(doc.file_size)}</div>
                <div className="text-xs">{doc.chunk_count ? `${doc.chunk_count} قطعة` : ''}</div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-left text-sm font-medium">
                {/* Placeholder for actions dropdown */}
                <button className="text-slate-400 hover:text-slate-200">
                  <MoreVertical size={20} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
