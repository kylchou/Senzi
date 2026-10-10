import { redirect } from "next/navigation";
import { StudyForm } from "@/components/vc/StudyForm";
import { getVcServices } from "@/lib/vc/server/container";
import { orNotFound, requirePageContext } from "@/lib/vc/server/page";

export default async function EditStudyPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const ctx = await requirePageContext(`/vc/studies/${studyId}/edit`);
  const detail = await orNotFound(getVcServices().studies.get(ctx, studyId));
  if (!detail.permissions.canEdit) redirect(`/vc/studies/${studyId}`);
  const { study, startup, openingLine, firmObservations } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">Edit draft study</h1>
      <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950">
        <StudyForm
          initial={{
            id: study.id,
            version: study.version,
            startup: startup ? { id: startup.id, name: startup.name } : null,
            question: study.question,
            yesCriteria: study.yesCriteria,
            noCriteria: study.noCriteria,
            context: study.context,
            openingLine: {
              link: openingLine?.link ?? null,
              observations: firmObservations ?? [],
              metricLabel: openingLine?.metricLabel ?? null,
            },
            deadline: study.deadline,
            visibility: study.visibility,
            sources: study.sources,
          }}
        />
      </div>
    </div>
  );
}
