'use client';

import { useState, useEffect } from 'react';
import { StatCards } from './StatCards';
import { Toolbar } from './Toolbar';
import { DocumentTable } from './DocumentTable';
import Skeleton from '@/components/ui/Skeleton';

// This type definition is based on our new schema and mock data.
// It will be used by child components like StatCards and the future DocumentTable.
export type Document = {
  id: string;
  original_filename: string;
  file_type: string;
  uploaded_at: string;
  uploaded_by: { name: string } | null; // Mocked relation
  processing_status: 'indexed' | 'processing' | 'error' | 'pending';
  chunk_count: number | null;
  file_size: number;
};

// Mock data representing the structure of a clinic_knowledge_document
const mockDocuments: Document[] = [
  {
    id: 'doc-1',
    original_filename: 'Dental Services Offered.pdf',
    file_type: 'pdf',
    uploaded_at: new Date('2026-07-24T10:00:00Z').toISOString(),
    uploaded_by: { name: 'Shadi A.' },
    processing_status: 'indexed',
    chunk_count: 42,
    file_size: 120456, // in bytes
  },
  {
    id: 'doc-2',
    original_filename: 'Clinic FAQ.docx',
    file_type: 'docx',
    uploaded_at: new Date('2026-07-23T14:30:00Z').toISOString(),
    uploaded_by: { name: 'Admin' },
    processing_status: 'processing',
    chunk_count: 15,
    file_size: 34567,
  },
  {
    id: 'doc-3',
    original_filename: 'insurance_partners.txt',
    file_type: 'txt',
    uploaded_at: new Date('2026-07-22T09:00:00Z').toISOString(),
    uploaded_by: { name: 'Shadi A.' },
    processing_status: 'error',
    chunk_count: 0,
    file_size: 2048,
  },
];

// A placeholder for the real data fetching function
async function fetchDocuments(clinicId: string): Promise<Document[]> {
  console.log(`Fetching documents for clinic ${clinicId}...`);
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  return mockDocuments;
}

export default function KnowledgeBaseManager() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchDocuments('clinic-123');
        setDocuments(data);
      } catch (e) {
        setError('فشل تحميل المستندات. يرجى المحاولة مرة أخرى.');
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleUploadClick = () => {
    // Placeholder for upload functionality
    alert('Placeholder for Upload Document modal.');
  };

  const filteredDocuments = documents.filter(doc =>
    doc.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="p-4 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      );
    }
    if (error) {
      return (
        <div className="p-8 text-center text-red-500">
           {error}
        </div>
      );
    }
    return <DocumentTable documents={filteredDocuments} />;
  };

  return (
    <div className="space-y-6">
      <StatCards documents={documents} isLoading={isLoading} />

      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onUploadClick={handleUploadClick}
      />

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
