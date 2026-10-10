import { notFound } from "next/navigation";
import { EmptyState } from "@/components/vc/EmptyState";
import { StudyTable } from "@/components/vc/StudyTable";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

/** Platform reviewers approve, reject and open submitted studies. */
export default async function ReviewQueuePage() {
  const ctx = await requirePageContext("/vc/review");
  if (!ctx.user.isPlatformAdmin) notFound();
  const rows = await getVcServices().studies.listReviewQueue(ctx);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Check that each question is measurable, uses public information only, and has a documented baseline methodology.
        </p>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        {rows.length === 0 ? <EmptyState title="Nothing awaiting review" /> : <StudyTable rows={rows} />}
      </div>
    </div>
  );
}
