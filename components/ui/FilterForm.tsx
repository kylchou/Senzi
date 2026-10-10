"use client";

import Form from "next/form";
import Link from "next/link";
import { useRef } from "react";
import { cn } from "./cn";
import { clearFilters, queryFromForm, saveFilters } from "./remembered-filters";

/**
 * GET form that navigates client-side and submits when a select or chip
 * changes. The submit button covers text search. The last filters are
 * remembered so navigation links can return to them.
 */
export function FilterForm({ action, children, className }: { action: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Form
      ref={ref}
      action={action}
      role="search"
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-end", className)}
      onSubmit={(event) => saveFilters(action, queryFromForm(event.currentTarget))}
      onChange={(event) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "SELECT" || (target as HTMLInputElement).type === "radio") ref.current?.requestSubmit();
      }}
    >
      {children}
    </Form>
  );
}

/** "Clear filters" link that also forgets the remembered filters. */
export function ClearFiltersLink({ path, className, children }: { path: string; className?: string; children: React.ReactNode }) {
  return (
    <Link href={path} className={className} onClick={() => clearFilters(path)}>
      {children}
    </Link>
  );
}
