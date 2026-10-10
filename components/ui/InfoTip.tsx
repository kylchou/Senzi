"use client";

import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { cn } from "./cn";

/**
 * Short explanation shown on hover or keyboard focus. The tooltip is removed
 * from layout while hidden (so it never widens the page) and shifts sideways
 * when it would run off the screen.
 */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  function place() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(256, window.innerWidth - 32);
    const center = rect.left + rect.width / 2;
    const left = center - width / 2;
    const right = center + width / 2;
    setShift(left < 16 ? 16 - left : right > window.innerWidth - 16 ? window.innerWidth - 16 - right : 0);
  }

  return (
    <span ref={rootRef} className={cn("group relative inline-flex align-middle", className)} onPointerEnter={place} onFocus={place}>
      <button type="button" aria-label={label} className="rounded-full p-0.5 text-ink-500 transition-colors hover:text-ink-900">
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-[min(16rem,calc(100vw-2rem))] animate-[vt-fade_150ms_ease-out] rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-surface shadow-[var(--shadow-lift)] group-focus-within:block group-hover:block"
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        {children}
      </span>
    </span>
  );
}
