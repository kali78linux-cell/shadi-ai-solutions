'use client';

import { useEffect, useRef } from 'react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

// Lightweight, RTL-friendly confirmation dialog (no new dependencies).
// - Blocks accidental destructive actions (cancel / complete / no-show).
// - Keyboard accessible: Escape cancels, confirm button receives focus.
// - Disables both actions while the request is in flight.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'تأكيد',
  cancelLabel = 'رجوع',
  tone = 'primary',
  pending = false,
  error = null,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    confirmButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, pending, onClose]);

  if (!open) return null;

  const confirmClasses =
    tone === 'danger'
      ? 'rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-60'
      : 'rounded-full bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="presentation"
        onClick={() => {
          if (!pending) onClose();
        }}
        className="absolute inset-0 bg-slate-950/80"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-950 p-6 shadow-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-base font-bold text-white">{title}</h2>
        {description && <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>}
        {error && (
          <div role="alert" className="mt-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-start gap-3">
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={confirmClasses}
          >
            {pending ? 'جارٍ التنفيذ...' : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-full border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}