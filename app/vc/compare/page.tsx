import { CompareSelector } from "@/components/vc/CompareSelector";
import { CompareView } from "@/components/vc/CompareView";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { MAX_COMPARE, MIN_COMPARE, parseCompareIds } from "@/lib/vc/compare";
import { formatDateTime } from "@/lib/vc/format";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function ComparePage({ searchParams }: PageProps<"/vc/compare">) {
  const ctx = await requirePageContext("/vc/compare");
  if (!ctx.activeOrg) return <NoWorkspace />;
  // Unknown or unpublished ids are dropped rather than failing the page.
  const requested = parseCompareIds((await searchParams).ids).slice(0, MAX_COMPARE);
  const startups = await getVcDeps().platform.getStartups(requested);
  const selected = requested
    .map((id) => startups.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  const comparison = selected.length >= MIN_COMPARE
    ? await getVcServices().compare.compare(ctx, selected.map((s) => s.id))
    : null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Compare startups</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Forecasting questions, track records, and public indicators side by side. Only data your firm can see is included.
        </p>
      </header>
      <CompareSelector selected={selected.map((s) => ({ id: s.id, name: s.name }))} />
      {comparison && (
        <>
          <p className="text-xs text-slate-500">Data as of {formatDateTime(comparison.generatedAt)}</p>
          <CompareView comparison={comparison} />
        </>
      )}
    </div>
  );
}
