import { cn } from "./cn";

const fieldBase =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3.5 text-sm shadow-[var(--shadow-card)] text-ink-900 placeholder:text-ink-500 transition-colors hover:border-ink-300 focus-visible:border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "cursor-pointer pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-ink-600", className)} {...props} />;
}
