import { cn } from "./cn";

export function ErrorState({
  title = "Something went wrong",
  body = "This could not load. Try again shortly.",
  action,
  className,
}: {
  title?: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-red-100 bg-red-50 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="font-display font-semibold text-ink-900">{title}</p>
      <p className="max-w-sm text-sm text-ink-700">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
