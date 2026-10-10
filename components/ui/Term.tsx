"use client";

import { useId, useRef, useState } from "react";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "./cn";

/**
 * A term with a dotted underline that explains itself on hover or keyboard
 * focus. Escape hides the explanation. The tooltip is out of layout while
 * hidden and shifts sideways to stay on screen.
 */
export function Term({ id, children, className }: { id: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const entry = GLOSSARY[id];
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  function place() {
    setDismissed(false);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(256, window.innerWidth - 32);
    const center = rect.left + rect.width / 2;
    const left = center - width / 2;
    const right = center + width / 2;
    setShift(left < 16 ? 16 - left : right > window.innerWidth - 16 ? window.innerWidth - 16 - right : 0);
  }

  return (
    <span ref={rootRef} className="group/term relative inline" onPointerEnter={place}>
      <button
        type="button"
        aria-describedby={tipId}
        onFocus={place}
        onKeyDown={(event) => event.key === "Escape" && setDismissed(true)}
        className={cn(
          "cursor-help rounded-sm [text-transform:inherit] underline decoration-ink-400 decoration-dotted decoration-1 underline-offset-[3px] transition-colors hover:decoration-ink-900",
          className,
        )}
      >
        {children ?? entry.term}
      </button>
      <span
        role="tooltip"
        id={tipId}
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-[min(16rem,calc(100vw-2rem))] animate-[vt-fade_150ms_ease-out] rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-surface shadow-[var(--shadow-lift)]",
          !dismissed && "group-hover/term:block group-focus-within/term:block",
        )}
        style={{ transform: `translateX(calc(-50% + ${shift}px))` }}
      >
        <span className="block font-semibold">{entry.term}</span>
        {entry.body}
      </span>
    </span>
  );
}
