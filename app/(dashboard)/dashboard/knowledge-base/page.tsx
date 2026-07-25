'use client';

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';
import DashboardSection from '@/components/dashboard/DashboardSection';
import EmptyState from '@/components/dashboard/EmptyState';
import { isSupabaseConfigured } from '@/lib/supabase';

type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

const indexedDocuments = [
  { name: 'services.txt', status: 'Indexed', count: '16 items' },
  { name: 'pricing.pdf', status: 'Indexed', count: '9 items' },
  { name: 'faq.docx', status: 'Processing', count: 'Waiting' },
];

export default function KnowledgeBasePage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [query, setQuery] = useState('');

  const filteredDocuments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return indexedDocuments;
    return indexedDocuments.filter((item) => item.name.toLowerCase().includes(normalized));
  }, [query]);

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setUploadState('uploading');

    const formData = new FormData();
    formData.append('clinic_id', '00000000-0000-0000-0000-000000000000');
    formData.append('title', file.name);
    formData.append('source_type', 'upload');
    formData.append('uploaded_by', 'system');
    formData.append('file', file);

    fetch('/api/ai/knowledge/upload', {
      method: 'POST',
      body: formData,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Upload failed');
        }
        setUploadState('done');
      })
      .catch(() => {
        setUploadState('error');
      });
    if (event.target) {
      event.target.value = '';
    }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setFileName(file.name);
      setUploadState('uploading');
      const formData = new FormData();
      formData.append('clinic_id', '00000000-0000-0000-0000-000000000000');
      formData.append('title', file.name);
      formData.append('source_type', 'upload');
      formData.append('uploaded_by', 'system');
      formData.append('file', file);
      fetch('/api/ai/knowledge/upload', {
        method: 'POST',
        body: formData,
      })
        .then((response) => {
          if (!response.ok) throw new Error('Upload failed');
          setUploadState('done');
        })
        .catch(() => setUploadState('error'));
    }
  }

  return (
    <div className="space-y-6">
      <DashboardSection title="Knowledge Base" subtitle="Professional upload and indexing workflow for the clinic AI content layer.">
        {!isSupabaseConfigured ? (
          <EmptyState title="Supabase is not configured" description="Upload and indexing are available once the clinic backend is connected to the existing knowledge API." />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
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
                <p className="mt-2 text-sm text-slate-400">PDF • DOCX • TXT • FAQ • Services • Pricing</p>
                <div className="mt-4 flex justify-center">
                  <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Choose file</button>
                </div>
                <input ref={inputRef} id="knowledge-upload" type="file" className="hidden" onChange={handleFileSelect} />
              </label>

              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-300">
                <div>Status: {uploadState}</div>
                {fileName ? <div className="mt-2">Selected: {fileName}</div> : null}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-800 bg-slate-950/70 p-5">
              <label htmlFor="knowledge-search" className="text-sm text-slate-400">Search indexed documents</label>
              <input id="knowledge-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by filename" className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20" />
              <div className="mt-4 space-y-3">
                {filteredDocuments.map((document) => (
                  <div key={document.name} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-300">
                    <div className="flex items-center justify-between gap-3">
                      <span>{document.name}</span>
                      <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300">{document.status}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">{document.count}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DashboardSection>
    </div>
  );
}
