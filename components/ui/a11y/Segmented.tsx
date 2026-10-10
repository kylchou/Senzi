"use client";

import { useRef } from "react";
import { cn } from "../cn";

/**
 * Compact segmented control with radio semantics: one tab stop, arrow keys
 * move the selection (WAI-ARIA radio group pattern).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const groupRef = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("grid auto-cols-fr grid-flow-col rounded-xl bg-ink-100 p-0.5", className)}
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.title}
            title={option.title}
            data-value={option.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-w-0 break-words rounded-[10px] px-2 py-1.5 text-xs font-semibold leading-tight text-ink-600 transition-[color,background-color,box-shadow] duration-150 hover:text-ink-900",
              checked && "bg-surface text-ink-900 shadow-[var(--shadow-card)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
