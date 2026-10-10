import { cn } from "./cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-ink-200 bg-surface shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}
