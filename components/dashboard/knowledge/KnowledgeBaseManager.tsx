'use client';

import { useState, useEffect } from 'react';
import { StatCards } from './StatCards';
import { Toolbar } from './Toolbar';
import { DocumentTable } from './DocumentTable';
import Skeleton from '@/components/ui/Skeleton';
import type { ClinicKnowledgeDocument } from '@/types/db';

// Mock data representing the structure of a clinic_knowledge_document
const mockDocuments: ClinicKnowledgeDocument[] = [
  {
    id: 'doc-1',
    clinic_id: 'clinic-123',
    uploaded_by: 'user-1',
    original_filename: 'Dental Services Offered.pdf',
    file_type: 'pdf',
    mime_type: 'application/pdf',
    file_size: 120456,
    checksum: 'checksum-1',
    language: 'en',
    storage_path: 'clinic-123/doc-1.pdf',
    upload_status: 'success',
    processing_status: 'indexed',
    chunk_count: 42,
    embedding_model: 'text-embedding-3-small',
    created_at: new Date('2026-07-24T10:00:00Z').toISOString(),
    updated_at: new Date('2026-07-24T10:00:00Z').toISOString(),
  },
  {
    id: 'doc-2',
    clinic_id: 'clinic-123',
    uploaded_by: 'user-2',
    original_filename: 'Clinic FAQ.docx',
    file_type: 'docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_size: 34567,
    checksum: 'checksum-2',
    language: 'en',
    storage_path: 'clinic-123/doc-2.docx',
    upload_status: 'success',
    processing_status: 'processing',
    chunk_count: 15,
    embedding_model: 'text-embedding-3-small',
    created_at: new Date('2026-07-23T14:30:00Z').toISOString(),
    updated_at: new Date('2026-07-23T14:30:00Z').toISOString(),
  },
  {
    id: 'doc-3',
    clinic_id: 'clinic-123',
    uploaded_by: 'user-3',
    original_filename: 'insurance_partners.txt',
    file_type: 'txt',
    mime_type: 'text/plain',
    file_size: 2048,
    checksum: 'checksum-3',
    language: 'en',
    storage_path: 'clinic-123/doc-3.txt',
    upload_status: 'success',
    processing_status: 'error',
    chunk_count: 0,
    embedding_model: 'text-embedding-3-small',
    created_at: new Date('2026-07-22T09:00:00Z').toISOString(),
    updated_at: new Date('2026-07-22T09:00:00Z').toISOString(),
  },
];

// A placeholder for the real data fetching function
async function fetchDocuments(clinicId: string): Promise<ClinicKnowledgeDocument[]> {
  console.log(`Fetching documents for clinic ${clinicId}...`);
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  return mockDocuments;
}

export default function KnowledgeBaseManager() {
  const [documents, setDocuments] = useState<ClinicKnowledgeDocument[]>([]);
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
