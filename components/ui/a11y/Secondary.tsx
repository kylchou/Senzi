"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Secondary information that Focus Mode tucks behind a "Show" button. Outside
 * Focus Mode it renders normally. Visibility is CSS-driven (a11y.css), so the
 * first paint is already right and nothing is removed from the page.
 */
export function Secondary({
  label,
  children,
  className,
  bodyClassName,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-secondary="" data-open={open ? "" : undefined} className={className}>
      <button
        type="button"
        data-secondary-toggle=""
        onClick={() => setOpen(true)}
        className="items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:border-ink-300 hover:text-ink-900"
      >
        Show {label}
        <ChevronDown className="size-4" aria-hidden />
      </button>
      <div data-secondary-body="" className={bodyClassName}>
        {children}
      </div>
    </div>
  );
}
