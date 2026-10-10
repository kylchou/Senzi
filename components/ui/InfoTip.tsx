import { Info } from "lucide-react";
import { cn } from "./cn";

/** Short explanation shown on hover or keyboard focus. */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("group relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-0.5 text-ink-500 transition-colors hover:text-ink-900"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-2 w-64 -translate-x-1/2 rounded-lg bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-surface opacity-0 shadow-[var(--shadow-lift)] transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
