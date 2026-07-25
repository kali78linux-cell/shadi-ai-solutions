'use client';

import { FormEvent, useState } from 'react';

const initialMessages = [
  { role: 'assistant', text: 'مرحبًا! كيف يمكنني مساعدتك اليوم؟' },
  { role: 'user', text: 'أود حجز موعد لتنظيف الأسنان.' },
  { role: 'assistant', text: 'بالطبع! هل ترغب بموعد صباحي أم مسائي؟' },
];

export default function ChatInterface() {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;

    setMessages((current) => [
      ...current,
      { role: 'user', text: draft },
      { role: 'assistant', text: 'تلقيت طلبك! سأقترح موعدًا قريبًا وسأوافيك بالتفاصيل.' },
    ]);
    setDraft('');
  }

  return (
    <div className="flex min-h-[40rem] flex-col rounded-[2rem] border border-slate-800 bg-slate-900/80 shadow-xl shadow-slate-950/30">
      <div className="rounded-t-[2rem] bg-slate-950/90 px-6 py-5">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300/80">محادثة AI</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`rounded-3xl px-5 py-4 ${
              message.role === 'assistant'
                ? 'bg-slate-950 text-slate-200'
                : 'bg-cyan-500/10 text-cyan-200 self-end'
            }`}
          >
            <p className="text-sm leading-6">{message.text}</p>
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="rounded-b-[2rem] border-t border-slate-800 bg-slate-950/90 px-6 py-5">
        <div className="flex gap-3">
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="اكتب رسالة..."
            className="min-w-0 flex-1 rounded-full border border-slate-800 bg-slate-900 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
          />
          <button
            type="submit"
            className="rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            إرسال
          </button>
        </div>
      </form>
    </div>
  );
}
