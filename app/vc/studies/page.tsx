import Link from "next/link";
import { EmptyState } from "@/components/vc/EmptyState";
import { StudyTable } from "@/components/vc/StudyTable";
import { STATUS_LABELS } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";
import { STUDY_STATUSES } from "@/lib/vc/types";
import { studyListQuery } from "@/lib/vc/validation";

const SCOPES = [
  { key: "organization", label: "My questions" },
  { key: "participating", label: "Invited" },
  { key: "public", label: "Public research" },
] as const;

export default async function StudiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePageContext("/vc/studies");
  const raw = await searchParams;
  const parsed = studyListQuery.safeParse({ scope: raw.scope, status: raw.status });
  const query = parsed.success ? parsed.data : { scope: "organization" as const };
  const rows = await getVcServices().studies.list(ctx, query);

  const href = (p: { scope?: string; status?: string }) => {
    const params = new URLSearchParams();
    params.set("scope", p.scope ?? query.scope);
    if (p.status) params.set("status", p.status);
    return `/vc/studies?${params}`;
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My questions</h1>
        {ctx.activeOrg && (
          <Link
            href="/vc/studies/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            Propose a study
          </Link>
        )}
      </header>

      <nav aria-label="Study scope" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {SCOPES.map((s) => (
          <Link
            key={s.key}
            href={href({ scope: s.key })}
            aria-current={query.scope === s.key ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              query.scope === s.key
                ? "border-slate-900 font-medium dark:border-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Filter by status">
        <Link
          href={href({})}
          className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${!query.status ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900" : "ring-slate-300 dark:ring-slate-700"}`}
        >
          All
        </Link>
        {STUDY_STATUSES.map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${query.status === s ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900" : "ring-slate-300 dark:ring-slate-700"}`}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        {rows.length === 0 ? (
          <EmptyState title="No studies found">
            {query.scope === "organization" ? "Propose a measurable YES/NO question to get started." : "Nothing here yet."}
          </EmptyState>
        ) : (
          <StudyTable rows={rows} />
        )}
      </div>
    </div>
  );
}
