"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Show a short confirmation in the corner. Safe to call from any client code. */
export function toast(message: string, tone: Tone = "success") {
  items = [...items.slice(-2), { id: nextId++, message, tone }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const empty: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => empty);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-20 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end md:bottom-6"
    >
      {list.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}

function Toast({ item }: { item: ToastItem }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), 3500);
    return () => window.clearTimeout(timer);
  }, [item.id]);

  const Icon = item.tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full max-w-sm animate-[toast-in_260ms_var(--ease-out-soft)] items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-surface shadow-[var(--shadow-lift)] sm:w-auto"
    >
      <Icon className="size-4 shrink-0 text-red-500" aria-hidden />
      <span className="flex-1">{item.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(item.id)}
        className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
