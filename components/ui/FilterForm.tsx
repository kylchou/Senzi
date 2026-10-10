"use client";

import { useRef } from "react";
import { cn } from "./cn";

/** GET form that submits when a select changes. The submit button covers no-JS and text search. */
export function FilterForm({ action, children, className }: { action: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={action}
      method="get"
      role="search"
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-end", className)}
      onChange={(event) => {
        if ((event.target as HTMLElement).tagName === "SELECT") ref.current?.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
