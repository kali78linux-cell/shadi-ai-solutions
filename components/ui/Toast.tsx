'use client';

import { useState, useEffect, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};

const typeConfig: Record<ToastType, { icon: string; className: string }> = {
  success: { icon: '✓', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  error: { icon: '✕', className: 'border-red-500/30 bg-red-500/10 text-red-300' },
  info: { icon: 'ⓘ', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' },
  warning: { icon: '!', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
};

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 11);
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);
    if (toast.duration !== Infinity) {
      setTimeout(() => removeToast(id), toast.duration ?? 4000);
    }
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { ToastContainer, addToast, removeToast };
}

export function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 z-[100] flex flex-col gap-3 px-4" dir="ltr">
      {toasts.map((toast) => {
        const config = typeConfig[toast.type];
        return (
          <div
            key={toast.id}
            className={`
              flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-xl shadow-black/30
              ${config.className} animate-slide-up
            `}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full text-base">{config.icon}</span>
            <span className="leading-5">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-4 text-xs opacity-50 hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Convenience functions for useToast ───
export const toast = {
  success: (message: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast:success', { detail: { message } }));
    }
  },
  error: (message: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast:error', { detail: { message } }));
    }
  },
  info: (message: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast:info', { detail: { message } }));
    }
  },
  warning: (message: string) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast:warning', { detail: { message } }));
    }
  },
};
