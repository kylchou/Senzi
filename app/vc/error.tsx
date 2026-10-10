"use client";

export default function VcError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-white p-6 dark:border-rose-900 dark:bg-slate-950">
      <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Something went wrong</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        We couldn&apos;t load this page. You may not have access, or a service may be temporarily unavailable.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Try again
      </button>
    </div>
  );
}
