'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';
import type { ConversationSummary, ThreadMessage } from '@/lib/services/clinicMessaging';

type Props = {
  clinicId: string | null;
  clinicSlug: string | null;
};

type FilePreview = {
  file: File;
  preview: string | null; // object URL for images only
  isImage: boolean;
};

export default function MessagingInterface({ clinicId }: Props) {
  const { authHeaders, activityType } = useClinicContext();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [partners, setPartners] = useState<Array<{ partner_id: string; partner_name: string; partner_type: string | null }>>([]);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [relFallback, setRelFallback] = useState<Array<{ partner_id: string; partner_name: string; partner_type: string | null }>>([]);
  const [selectedPartner, setSelectedPartner] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showPatient, setShowPatient] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientNotes, setPatientNotes] = useState('');
  // Attach-to-patient modal state (Phase I)
  const [attachTarget, setAttachTarget] = useState<string | null>(null);
  const [attachQuery, setAttachQuery] = useState('');
  const [attachResults, setAttachResults] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachSuccess, setAttachSuccess] = useState<string | null>(null);
  const [newPatientOpen, setNewPatientOpen] = useState(false);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientPhone, setNewPatientPhone] = useState('');
  // Suggest-clinic modal state (Phase I, for imaging centers / labs)
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestPartnerId, setSuggestPartnerId] = useState('');
  const [suggestName, setSuggestName] = useState('');
  const [suggestPhone, setSuggestPhone] = useState('');
  const [suggestNotes, setSuggestNotes] = useState('');
  const [suggestFile, setSuggestFile] = useState<File | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/clinic/messages?clinic_id=${clinicId}`, { headers });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تحميل المحادثات');
      setConversations(json.data ?? []);
      setPartners(json.partners ?? []);
      // Fallback: لو الـ deployment القديم لا يعيد `partners` (ملف المسار غير
      // منشور بعد)، اجلب الشركاء المقبولين من API العلاقات مباشرة.
      if ((!json.partners || json.partners.length === 0) && clinicId) {
        try {
          const relRes = await fetch(
            `/api/clinic/organization-relationships?clinic_id=${clinicId}`,
            { headers }
          );
          if (relRes.ok) {
            const relJson = await relRes.json();
            const rows: Array<{
              status: string;
              direction: 'outgoing' | 'incoming';
              source_org: { id: string; name: string; activity_type: string | null };
              target_org: { id: string; name: string; activity_type: string | null };
            }> = relJson.data ?? [];
            setRelFallback(
              rows
                .filter((r) => r.status === 'accepted')
                .map((r) => {
                  const other = r.direction === 'outgoing' ? r.target_org : r.source_org;
                  return {
                    partner_id: other.id,
                    partner_name: other.name,
                    partner_type: other.activity_type,
                  };
                })
            );
          }
        } catch {
          /* تجاهل — القائمة الأساسية كافية */
        }
      } else {
        setRelFallback([]);
      }
      const totalUnread = (json.data ?? []).reduce(
        (sum: number, c: ConversationSummary) => sum + (c.unread_count ?? 0),
        0
      );
      setUnreadCount(totalUnread);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, [clinicId, authHeaders]);

  const fetchThread = useCallback(
    async (partnerId: string) => {
      if (!clinicId) return;
      setThreadLoading(true);
      try {
        const headers = await authHeaders();
        const res = await fetch(
          `/api/clinic/messages/thread?clinic_id=${clinicId}&partner_id=${partnerId}`,
          { headers }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'فشل تحميل الرسائل');
        setMessages(json.data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'حدث خطأ');
      } finally {
        setThreadLoading(false);
      }
    },
    [clinicId, authHeaders]
  );

  useEffect(() => {
    void fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedPartner) {
      void fetchThread(selectedPartner.partner_id);
    }
  }, [selectedPartner, fetchThread]);

  // Mark incoming messages read when the thread opens (awaited headers — was a Promise).
  useEffect(() => {
    if (!selectedPartner || !clinicId) return;
    const unread = selectedPartner.unread_count ?? 0;
    void (async () => {
      const headers = await authHeaders();
      void fetch(
        `/api/clinic/messages/mark-read?clinic_id=${clinicId}&partner_id=${selectedPartner.partner_id}`,
        { method: 'PUT', headers }
      );
    })();
    if (unread > 0) {
      setUnreadCount((prev) => Math.max(0, prev - unread));
      setConversations((prev) =>
        prev.map((c) =>
          c.partner_id === selectedPartner.partner_id ? { ...c, unread_count: 0 } : c
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartner?.partner_id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function clearFiles() {
    setFiles((prev) => {
      prev.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      return [];
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      isImage: file.type.startsWith('image/'),
    }));
    setFiles((prev) => [...prev, ...picked]);
    e.target.value = '';
  }

  async function uploadFile(file: File): Promise<{ url: string; name: string; size: number }> {
    const formData = new FormData();
    formData.append('file', file);
    const headers = await authHeaders(); // Authorization only — never set content-type for FormData
    const res = await fetch(`/api/clinic/messages/upload?clinic_id=${clinicId}`, {
      method: 'POST',
      headers,
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'فشل رفع الملف');
    // Route contract: { data: { file_url, file_name, file_size } }
    return {
      url: json.data.file_url as string,
      name: json.data.file_name as string,
      size: json.data.file_size as number,
    };
  }

  async function postMessage(body: Record<string, unknown>): Promise<ThreadMessage> {
    const headers = await authHeaders();
    const res = await fetch(`/api/clinic/messages?clinic_id=${clinicId}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'فشل إرسال الرسالة');
    return { ...json.data, direction: 'outgoing' } as ThreadMessage;
  }

  async function sendMessage() {
    if (!selectedPartner || !clinicId) return;
    if (!content.trim() && files.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const patientFields =
        patientName.trim() || patientPhone.trim() || patientNotes.trim()
          ? {
              patient_name: patientName.trim() || null,
              patient_phone: patientPhone.trim() || null,
              patient_notes: patientNotes.trim() || null,
            }
          : {};

      const uploaded: { url: string; name: string; size: number }[] = [];
      for (const f of files) {
        uploaded.push(await uploadFile(f.file));
      }

      const sent: ThreadMessage[] = [];
      let patientAttached = false;

      if (content.trim()) {
        sent.push(
          await postMessage({
            to_clinic_id: selectedPartner.partner_id,
            content: content.trim(),
            ...patientFields,
          })
        );
        patientAttached = true;
      }
      for (const up of uploaded) {
        sent.push(
          await postMessage({
            to_clinic_id: selectedPartner.partner_id,
            file_url: up.url,
            file_name: up.name,
            file_size: up.size,
            ...(patientAttached ? {} : patientFields),
          })
        );
        patientAttached = true;
      }

      setMessages((prev) => [...prev, ...sent]);
      setContent('');
      setPatientName('');
      setPatientPhone('');
      setPatientNotes('');
      setShowPatient(false);
      clearFiles();
      void fetchConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSending(false);
    }
  }

  // ── PHASE I: Attach-to-patient handlers ─────────────────────────────
  async function handleAttachSearch() {
    if (!clinicId) return;
    const q = attachQuery.trim().replace(/^0+/, '').replace(/\s+/g, '');
    if (!q) {
      setAttachError('اكتب اسم المريض أو رقم هاتفه للبحث');
      return;
    }
    setAttachBusy(true);
    setAttachError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/patients?clinic_id=${encodeURIComponent(clinicId)}&q=${encodeURIComponent(attachQuery.trim())}`,
        { headers }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل البحث');
      const list = Array.isArray(json) ? json : json.data ?? [];
      setAttachResults(
        list.map((p: any) => ({
          id: p.id ?? p.patient_id,
          name: p.name ?? p.full_name ?? 'مريض',
          phone: p.phone ?? p.phone_number ?? '',
        }))
      );
      if (list.length === 0) {
        setAttachError('لم يُعثر على مريض مطابق. يمكنك إنشاء مريض جديد.');
        setAttachSuccess('لم يُعثر على مريض — أضف مريضاً جديداً.');
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'حدث خطأ أثناء البحث');
    } finally {
      setAttachBusy(false);
    }
  }

  async function createPatientAndAttach() {
    if (!clinicId || !attachTarget) return;
    const name = newPatientName.trim();
    const phone = newPatientPhone.trim().replace(/^0+/, '').replace(/\s+/g, '');
    if (!name || !phone) {
      setAttachError('أدخل اسم المريض ورقم هاتف ساري (بدون الصفر البادئ)');
      return;
    }
    setAttachBusy(true);
    setAttachError(null);
    setAttachSuccess(null);
    try {
      const headers = await authHeaders();
      const createdRes = await fetch(`/api/patients?clinic_id=${encodeURIComponent(clinicId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ clinic_id: clinicId, name, phone }),
      });
      const createdJson = await createdRes.json();
      if (!createdRes.ok) throw new Error(createdJson.error || 'فشل إنشاء المريض');
      const patientId = createdJson.id ?? createdJson.patient_id;
      await runAttach(patientId);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setAttachBusy(false);
    }
  }

  async function runAttach(patientId: string) {
    if (!clinicId || !attachTarget) return;
    const headers = await authHeaders();
    const res = await fetch(
      `/api/clinic/messages/${encodeURIComponent(attachTarget)}/attach-patient`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ clinic_id: clinicId, patient_id: patientId }),
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'تعذر إرفاق الملف');
    setAttachSuccess('تم إرفاق الملف إلى ملف المريض بنجاح ✓');
    setAttachResults([]);
    setNewPatientOpen(false);
    setNewPatientName('');
    setNewPatientPhone('');
  }

  // ── PHASE I: Suggest-clinic (imaging center → partner dental clinic) ──
  async function sendSuggestion() {
    if (!clinicId || !suggestPartnerId) {
      setAttachError('اختر عيادة شريكة أولاً');
      return;
    }
    const phone = suggestPhone.trim().replace(/^0+/, '').replace(/\s+/g, '');
    if (!suggestName.trim() || !phone) {
      setAttachError('أدخل اسم المريض ورقم هاتف ساري');
      return;
    }
    setSuggestBusy(true);
    setAttachError(null);
    setAttachSuccess(null);
    try {
      const headers = await authHeaders();
      let content = `🏥 اقتراح مريض جديد للمراجعة\nالمريض: ${suggestName.trim()}\nالهاتف: ${suggestPhone.trim()}`;
      if (suggestNotes.trim()) content += `\nملاحظات: ${suggestNotes.trim()}`;
      let file_url: string | null = null;
      let file_name: string | null = null;
      let file_size: number | null = null;
      if (suggestFile) {
        const fd = new FormData();
        fd.append('file', suggestFile);
        const up = await fetch(`/api/clinic/messages/upload?clinic_id=${encodeURIComponent(clinicId)}`, {
          method: 'POST',
          headers,
          body: fd,
        });
        const upJson = await up.json();
        if (!up.ok) throw new Error(upJson.error || 'فشل رفع المرفق');
        file_url = upJson.data.file_url;
        file_name = upJson.data.file_name;
        file_size = upJson.data.file_size;
      }
      const res = await fetch('/api/clinic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          to_clinic_id: suggestPartnerId,
          content,
          file_url,
          file_name,
          file_size,
          patient_name: suggestName.trim(),
          patient_phone: suggestPhone.trim(),
          patient_notes: suggestNotes.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل إرسال الاقتراح');
      setAttachSuccess('تم إرسال اقتراح العيادة إلى العيادة الشريكة ✓');
      setSuggestOpen(false);
      setSuggestPartnerId('');
      setSuggestName('');
      setSuggestPhone('');
      setSuggestNotes('');
      setSuggestFile(null);
      void fetchConversations();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setSuggestBusy(false);
    }
  }

  // القائمة الموحدة: شركاء الـ API أولاً، ثم fallback العلاقات (بدون تكرار).
  const allPartners =
    partners.length > 0
      ? partners
      : relFallback.filter((f) => !partners.some((p) => p.partner_id === f.partner_id));

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4 md:flex-row">
      {/* Conversations sidebar */}
      <div className="w-full max-w-xs overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/50">
        <div className="border-b border-slate-800 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">الرسائل</h2>
            {(activityType === 'imaging_center' || activityType === 'dental_lab') && allPartners.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSuggestOpen(true);
                  setSuggestPartnerId('');
                  setSuggestName('');
                  setSuggestPhone('');
                  setSuggestNotes('');
                  setSuggestFile(null);
                  setAttachError(null);
                  setAttachSuccess(null);
                }}
                className="rounded-full bg-violet-500/20 px-3 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/30"
                title="اقتراح مريض جديد لعيادة شريكة"
              >
                🏥 اقتراح عيادة
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNewChatOpen((v) => !v)}
            className="mt-2 w-full rounded-full bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/30"
          >
            ➕ محادثة جديدة
          </button>
          {newChatOpen && (
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 p-2">
              {allPartners.length === 0 ? (
                <p className="p-2 text-center text-xs text-slate-500">لا يوجد شركاء مرتبطون. أرسل طلب ارتباط أولاً.</p>
              ) : (
                allPartners.map((p) => (
                  <button
                    key={p.partner_id}
                    type="button"
                    onClick={() => {
                      setSelectedPartner({
                        partner_id: p.partner_id,
                        partner_name: p.partner_name,
                        partner_slug: null,
                        partner_activity: p.partner_type ?? '',
                        last_message_id: '',
                        last_content: null,
                        last_file_name: null,
                        last_created_at: '',
                        unread_count: 0,
                      } as ConversationSummary);
                      setMessages([]);
                      setNewChatOpen(false);
                    }}
                    className="block w-full rounded-lg p-2 text-right text-sm text-slate-200 hover:bg-slate-800/60"
                  >
                    {p.partner_name}
                    <span className="mr-2 text-[10px] text-slate-500">{p.partner_type ?? ''}</span>
                  </button>
                ))
              )}
            </div>
          )}
          {unreadCount > 0 && (
            <span className="mt-1 block text-xs text-cyan-300">{unreadCount} رسائل غير مقروءة</span>
          )}
        </div>
        {loading ? (
          <div className="p-4 text-center text-slate-500">جارٍ التحميل...</div>
        ) : conversations.length === 0 && allPartners.length === 0 ? (
          <div className="p-4 text-center text-slate-500">
            لا يوجد شركاء مرتبطون. أرسل طلب ارتباط أولاً.
          </div>
        ) : conversations.length === 0 && allPartners.length > 0 ? (
          <div className="p-4 text-center text-slate-500">
            <p>لا توجد محادثات بعد.</p>
            <p className="mt-1 text-xs">اضغط «➕ محادثة جديدة» لبدء محادثة مع أحد الشركاء ({allPartners.length}).</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {conversations.map((c) => (
              <li key={c.partner_id}>
                <button
                  type="button"
                  onClick={() => setSelectedPartner(c)}
                  className={`block w-full cursor-pointer p-3 text-right transition ${
                    selectedPartner?.partner_id === c.partner_id
                      ? 'bg-cyan-500/10'
                      : 'hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{c.partner_name}</p>
                    {c.unread_count > 0 && selectedPartner?.partner_id !== c.partner_id && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-[calc(100%-16px)] truncate text-xs text-slate-400">
                    {c.last_content || c.last_file_name || 'رسالة مرفقة'}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {new Date(c.last_created_at).toLocaleString('ar-EG', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Thread + composer */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50">
        <div className="border-b border-slate-800 p-4">
          <h3 className="text-lg font-semibold text-white">
            {selectedPartner?.partner_name ?? 'اختر محادثة'}
          </h3>
          {selectedPartner?.partner_activity && (
            <p className="text-sm text-slate-400">{selectedPartner.partner_activity}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedPartner ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p>اختر محادثة من القائمة الجانبية</p>
            </div>
          ) : threadLoading ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p>جارٍ تحميل الرسائل...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p>لا رسائل بعد. ابدأ المحادثة!</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[70%] rounded-2xl p-3 ${
                    m.direction === 'outgoing'
                      ? 'ml-auto bg-cyan-500/15 text-cyan-50'
                      : 'mr-auto bg-slate-800/50 text-slate-200'
                  }`}
                >
                  {m.content && <p className="text-sm break-words">{m.content}</p>}
                  {m.file_name && (
                    <div className="mt-2">
                      {m.file_url ? (
                        <a
                          href={m.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-xs text-cyan-300 underline"
                        >
                          📎 {m.file_name}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                          📎 {m.file_name}
                        </span>
                      )}
                      {m.file_size != null && (
                        <span className="ms-2 text-[10px] text-slate-500">
                          {(m.file_size / 1024).toFixed(1)} KB
                        </span>
                      )}
                    </div>
                  )}
                  {m.file_name && (
                    <button
                      type="button"
                      onClick={() => {
                        setAttachTarget(m.id);
                        setAttachQuery('');
                        setAttachResults([]);
                        setAttachError(null);
                        setAttachSuccess(null);
                        setNewPatientOpen(false);
                      }}
                      className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                      title="إرفاق الملف إلى ملف المريض (البحث أو إنشاء مريض)"
                    >
                      📁 إرفاق إلى ملف المريض
                    </button>
                  )}
                  {(m.patient_name || m.patient_phone || m.patient_notes) && (
                    <div className="mt-2 rounded-xl border border-slate-700/30 bg-slate-900/30 p-2">
                      <p className="text-xs text-slate-300">
                        <strong>مريض:</strong> {m.patient_name ?? '—'}
                        {m.patient_phone ? ` — ${m.patient_phone}` : ''}
                      </p>
                      {m.patient_notes && (
                        <p className="mt-1 text-xs text-slate-400">{m.patient_notes}</p>
                      )}
                    </div>
                  )}
                  <p
                    className={`mt-1 text-[10px] opacity-60 ${
                      m.direction === 'outgoing' ? 'text-cyan-200/60' : 'text-slate-400'
                    }`}
                  >
                    {new Date(m.created_at).toLocaleTimeString('ar-EG', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </li>
              ))}
              <div ref={messagesEndRef} />
            </ul>
          )}
        </div>
        {selectedPartner && (
          <div className="border-t border-slate-800 p-3">
            {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}

            {files.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto">
                {files.map((f, i) => (
                  <div key={i} className="relative shrink-0">
                    {f.isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={f.preview ?? ''}
                        alt={f.file.name}
                        className="h-16 w-16 rounded-lg border border-slate-700 object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-2xl">
                        {f.file.name.toLowerCase().endsWith('.pdf') ? '📄' : '🩻'}
                      </div>
                    )}
                    <button
                      type="button"
                      aria-label={`إزالة ${f.file.name}`}
                      onClick={() => {
                        if (f.preview) URL.revokeObjectURL(f.preview);
                        setFiles((prev) => prev.filter((_, j) => j !== i));
                      }}
                      className="absolute -top-1 -right-1 rounded-full bg-rose-500/80 px-1 text-xs text-white"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showPatient && (
              <div className="mb-2 grid gap-2 rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 sm:grid-cols-3">
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="اسم المريض"
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                />
                <input
                  type="tel"
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="هاتف المريض"
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                />
                <input
                  type="text"
                  value={patientNotes}
                  onChange={(e) => setPatientNotes(e.target.value)}
                  placeholder="ملاحظات عن الحالة"
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                />
              </div>
            )}

            <div className="flex items-end gap-2">
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="اكتب رسالتك..."
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowPatient((v) => !v)}
                title="إرفاق معلومات مريض"
                className={`rounded-full px-3 py-2 text-sm transition ${
                  showPatient || patientName || patientPhone || patientNotes
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                🧑‍⚕️
              </button>
              <label className="cursor-pointer rounded-full bg-slate-800 px-3 py-2 text-slate-300 transition hover:bg-slate-700">
                📎
                <input
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.dcm"
                  multiple
                  onChange={handleFileUpload}
                />
              </label>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sending || (!content.trim() && files.length === 0)}
                className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50"
              >
                {sending ? 'جارٍ الإرسال...' : 'إرسال'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── PHASE I: Attach-to-patient modal ── */}
      {attachTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAttachTarget(null)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-700/60 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-semibold text-white">📁 إرفاق إلى ملف المريض</h4>
              <button
                type="button"
                onClick={() => setAttachTarget(null)}
                className="rounded-full bg-slate-800 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-700"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>

            {attachSuccess && (
              <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                {attachSuccess}
              </div>
            )}
            {attachError && (
              <div className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                {attachError}
              </div>
            )}

            {/* Search existing patient */}
            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={attachQuery}
                onChange={(e) => setAttachQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAttachSearch();
                }}
                placeholder="ابحث بالاسم أو الهاتف..."
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleAttachSearch()}
                disabled={attachBusy}
                className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
              >
                {attachBusy ? '...' : 'بحث'}
              </button>
            </div>

            {/* Results */}
            {attachResults.length > 0 && (
              <ul className="mb-3 max-h-44 space-y-2 overflow-y-auto">
                {attachResults.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-200">{p.name}</p>
                      {p.phone && <p className="text-xs text-slate-400">{p.phone}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={attachBusy}
                      onClick={async () => {
                        setAttachBusy(true);
                        setAttachError(null);
                        setAttachSuccess(null);
                        try {
                          await runAttach(p.id);
                        } catch (err) {
                          setAttachError(err instanceof Error ? err.message : 'حدث خطأ');
                        } finally {
                          setAttachBusy(false);
                        }
                      }}
                      className="rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                    >
                      إرفاق
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Create new patient */}
            {!newPatientOpen ? (
              <button
                type="button"
                onClick={() => setNewPatientOpen(true)}
                className="text-xs font-medium text-cyan-300 underline hover:text-cyan-200"
              >
                + مريض جديد (غير موجود في السجل)
              </button>
            ) : (
              <div className="mt-2 space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <input
                  type="text"
                  value={newPatientName}
                  onChange={(e) => setNewPatientName(e.target.value)}
                  placeholder="اسم المريض"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                />
                <input
                  type="tel"
                  value={newPatientPhone}
                  onChange={(e) => setNewPatientPhone(e.target.value)}
                  placeholder="رقم الهاتف (بدون الصفر البادئ)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void createPatientAndAttach()}
                    disabled={attachBusy}
                    className="flex-1 rounded-full bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                  >
                    {attachBusy ? 'جارٍ الإنشاء والإرفاق...' : 'إنشاء وإرفاق'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPatientOpen(false)}
                    className="rounded-full bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PHASE I: Suggest-clinic modal ── */}
      {suggestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSuggestOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-700/60 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h4 className="text-base font-semibold text-white">🏥 اقتراح عيادة لمريض جديد</h4>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="rounded-full bg-slate-800 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-700"
                aria-label="إغلاق"
              >
                ×
              </button>
            </div>

            <select
              value={suggestPartnerId}
              onChange={(e) => setSuggestPartnerId(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-violet-500/70 focus:outline-none"
            >
              <option value="">اختر العيادة الشريكة...</option>
              {allPartners.map((p) => (
                <option key={p.partner_id} value={p.partner_id}>{p.partner_name}</option>
              ))}
            </select>

            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <input
                type="text"
                value={suggestName}
                onChange={(e) => setSuggestName(e.target.value)}
                placeholder="اسم المريض"
                className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500/70 focus:outline-none"
              />
              <input
                type="tel"
                value={suggestPhone}
                onChange={(e) => setSuggestPhone(e.target.value)}
                placeholder="هاتف المريض"
                className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500/70 focus:outline-none"
              />
            </div>
            <textarea
              value={suggestNotes}
              onChange={(e) => setSuggestNotes(e.target.value)}
              placeholder="ملاحظات الحالة (اختياري)"
              rows={2}
              className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500/70 focus:outline-none"
            />

            <label className="mb-1 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <span className="rounded-full bg-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-700">📎 إرفاق صورة/أشعة</span>
              <span className="text-slate-500">{suggestFile ? suggestFile.name : '(اختياري)'}</span>
              <input
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.dcm"
                onChange={(e) => setSuggestFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void sendSuggestion()}
                disabled={suggestBusy}
                className="flex-1 rounded-full bg-violet-500 px-4 py-2 text-xs font-bold text-white hover:bg-violet-400 disabled:opacity-50"
              >
                {suggestBusy ? 'جارٍ الإرسال...' : 'إرسال الاقتراح للعيادة'}
              </button>
              <button
                type="button"
                onClick={() => setSuggestOpen(false)}
                className="rounded-full bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

