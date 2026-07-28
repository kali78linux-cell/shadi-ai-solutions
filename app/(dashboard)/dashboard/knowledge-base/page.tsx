'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import { isSupabaseConfigured } from '@/lib/supabase';
import { ClinicKnowledgeDocument } from '@/types/db';
import { StatCards } from '@/components/dashboard/knowledge/StatCards';

type UploadStatus = {
  state: 'idle' | 'uploading' | 'done' | 'error';
  message: string;
};

export default function KnowledgeBasePage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [documents, setDocuments] = useState<ClinicKnowledgeDocument[]>([]);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ state: 'idle', message: 'Ready to upload.' });
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({});

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/knowledge/documents');
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (error) {
      console.error(error);
      // Optionally set an error state to show in the UI
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSupabaseConfigured) {
      fetchDocuments();
    } else {
      setIsLoading(false);
    }
  }, [fetchDocuments]);

  // Poll for status updates on documents that are being processed
  useEffect(() => {
    const hasPendingDocuments = documents.some(doc => ['pending', 'processing', 'chunking', 'embedding'].includes(doc.processing_status));
    if (!hasPendingDocuments) return;

    const intervalId = setInterval(fetchDocuments, 5000); // Poll every 5 seconds

    return () => clearInterval(intervalId);
  }, [documents, fetchDocuments]);

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return documents;
    return documents.filter((item) => item.original_filename.toLowerCase().includes(normalized));
  }, [query, documents]);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file) return;

    setUploadStatus({ state: 'uploading', message: `Uploading ${file.name}...` });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/ai/knowledge/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const { document: newDocument } = await response.json();
      setDocuments((prev) => [newDocument, ...prev]);
      setUploadStatus({ state: 'done', message: `Upload successful for ${file.name}. Processing has started.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred.';
      setUploadStatus({ state: 'error', message: `Upload failed: ${message}` });
    }
  }, []);

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
    if (event.target) {
      event.target.value = ''; // Reset input to allow re-uploading the same file
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }

  const handleAction = async (action: 'delete' | 'reindex', documentId: string) => {
    if (actionStates[documentId]) return; // Prevent multiple clicks

    const isDelete = action === 'delete';
    if (isDelete && !confirm(`Are you sure you want to delete this document? This action cannot be undone.`)) {
      return;
    }

    setActionStates(prev => ({ ...prev, [documentId]: true }));

    try {
      const response = await fetch(`/api/ai/knowledge/documents/${documentId}`, {
        method: isDelete ? 'DELETE' : 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${action} document.`);
      }

      // Re-fetch to get the updated status
      await fetchDocuments();
    } catch (error) {
      alert(error instanceof Error ? error.message : `An unknown error occurred.`);
    } finally {
      setActionStates(prev => ({ ...prev, [documentId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <DashboardSection title="Knowledge Base" subtitle="Professional upload and indexing workflow for the clinic AI content layer.">
        {!isSupabaseConfigured ? (
          <EmptyState title="Supabase is not configured" description="Upload and indexing are available once the clinic backend is connected to the existing knowledge API." />
        ) : (
          <>
            <StatCards documents={documents} />
            <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.9fr]">
              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <label
                  htmlFor="knowledge-upload"
                  onDrop={handleDrop}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  className={`block rounded-[1.5rem] border border-dashed p-8 text-center transition ${isDragging ? 'border-cyan-500 bg-cyan-500/10' : 'border-slate-700 bg-slate-900/80'}`}
                >
                  <p className="text-lg font-semibold text-white">Drag & drop documents</p>
                  <p className="mt-2 text-sm text-slate-400">PDF • DOCX • TXT</p>
                  <div className="mt-4 flex justify-center">
                    <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Choose file</button>
                  </div>
                  <input ref={inputRef} id="knowledge-upload" type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={handleFileSelect} />
                </label>

                <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                  <div>Status: {uploadStatus.state}</div>
                  <div className="mt-2">{uploadStatus.message}</div>
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
                <label htmlFor="knowledge-search" className="text-sm text-slate-400">Search indexed documents</label>
                <input id="knowledge-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by filename" className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20" />
                <div className="mt-4 space-y-3">
                  {isLoading ? (
                    <p className="text-center text-slate-400">Loading documents...</p>
                  ) : filteredDocuments.length > 0 ? (
                    filteredDocuments.map((doc) => (
                      <div key={doc.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium text-slate-100">{doc.original_filename}</span>
                          <span className={`flex-shrink-0 rounded-full border px-3 py-1 text-xs capitalize ${
                            doc.processing_status === 'indexed' ? 'border-green-500/30 bg-green-500/10 text-green-300' :
                            doc.processing_status === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-300' :
                            'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                          }`}>{doc.processing_status}</span>
                        </div>
                        <div className="mt-2 flex justify-between text-xs text-slate-400">
                          <span>{doc.chunk_count ? `${doc.chunk_count} chunks` : 'Awaiting processing'}</span>
                          <span>{formatBytes(doc.file_size)}</span>
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-800 pt-2">
                          <button
                            onClick={() => handleAction('reindex', doc.id)}
                            disabled={actionStates[doc.id]}
                            className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                          >
                            {actionStates[doc.id] ? '...' : 'Re-index'}
                          </button>
                          <button
                            onClick={() => handleAction('delete', doc.id)}
                            disabled={actionStates[doc.id]}
                            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                          >
                            {actionStates[doc.id] ? '...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="py-4 text-center text-sm text-slate-400">No documents found.</p>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DashboardSection>
    </div>
  );
}
