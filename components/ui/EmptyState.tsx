import { cn } from "./cn";
import { Illustration, type IllustrationName } from "./Illustration";

export function EmptyState({
  title,
  body,
  action,
  illustration = "generic",
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  illustration?: IllustrationName;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-ink-50 px-6 py-12 text-center",
        className,
      )}
    >
      <Illustration name={illustration} />
      <p className="mt-2 font-display font-semibold text-ink-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-600">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
