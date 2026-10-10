import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-950">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        This item doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link href="/vc" className="mt-4 inline-block text-sm underline">
        Back to dashboard
      </Link>
    </div>
  );
}
