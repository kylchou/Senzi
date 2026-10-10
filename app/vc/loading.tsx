export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="h-7 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
