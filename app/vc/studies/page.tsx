import Link from "next/link";
import { EmptyState } from "@/components/vc/EmptyState";
import { StudyTable } from "@/components/vc/StudyTable";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";
import type { StudyStatus } from "@/lib/vc/types";
import { studyListQuery } from "@/lib/vc/validation";

const SCOPES = [
  { key: "organization", label: "Your firm" },
  { key: "public", label: "Public research" },
] as const;

/** Four groups instead of one chip per status. */
const GROUPS = [
  { key: "all", label: "All", statuses: null },
  { key: "in-progress", label: "In progress", statuses: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] },
  { key: "open", label: "Open", statuses: ["OPEN"] },
  { key: "finished", label: "Finished", statuses: ["CLOSED", "RESOLVED", "CANCELLED"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly StudyStatus[] | null }[];

type GroupKey = (typeof GROUPS)[number]["key"];

export default async function StudiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePageContext("/vc/studies");
  const raw = await searchParams;
  // `status` still works for deep links to a single status.
  const parsed = studyListQuery.safeParse({ scope: raw.scope, status: raw.status });
  const query = parsed.success ? parsed.data : { scope: "organization" as const };
  const group = GROUPS.find((g) => g.key === raw.group) ?? GROUPS[0];
  const rows = (await getVcServices().studies.list(ctx, query)).filter(
    (r) => !group.statuses || (group.statuses as readonly StudyStatus[]).includes(r.study.status),
  );

  const href = (p: { scope?: string; group?: GroupKey }) => {
    const params = new URLSearchParams();
    params.set("scope", p.scope ?? query.scope);
    const g = p.group ?? (p.scope ? "all" : group.key);
    if (g !== "all") params.set("group", g);
    return `/vc/studies?${params}`;
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Questions</h1>
        {ctx.activeOrg && (
          <Link
            href="/vc/studies/new"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            Ask a question
          </Link>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
        <nav aria-label="Whose questions" className="flex gap-1">
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
        <div className="flex flex-wrap gap-1.5 pb-2 text-xs" aria-label="Filter by stage">
          {GROUPS.map((g) => (
            <Link
              key={g.key}
              href={href({ group: g.key })}
              aria-current={g.key === group.key && !query.status ? "true" : undefined}
              className={`rounded-full px-2.5 py-1 ring-1 ring-inset ${
                g.key === group.key && !query.status
                  ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900"
                  : "ring-slate-300 dark:ring-slate-700"
              }`}
            >
              {g.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        {rows.length === 0 ? (
          <EmptyState title="No questions here">
            {query.scope === "organization" ? "Ask a YES/NO question about a company to get started." : "Nothing here yet."}
          </EmptyState>
        ) : (
          <StudyTable rows={rows} />
        )}
      </div>
    </div>
  );
}
