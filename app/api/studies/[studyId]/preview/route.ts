import { studyModelEvidence } from "@/lib/vc/server/company-model";
import { ok, withVc } from "@/lib/vc/server/http";
import type { StudyPreview } from "@/lib/vc/preview";

type Params = { studyId: string };

/**
 * GET /api/studies/:studyId/preview — the compact view the dashboard opens
 * when a study row is clicked: headline numbers, the three-line history and
 * the model's sources. Same permissions as the full study.
 */
export const GET = withVc<Params>(async ({ params, ctx, services }) => {
  const { study, estimate, history, startup } = await services.studies.get(ctx, params.studyId);
  const evidence = await studyModelEvidence(ctx, study.startupId, study.marketId);
  const preview: StudyPreview = {
    id: study.id,
    marketId: study.marketId,
    question: study.question,
    status: study.status,
    deadline: study.deadline.toISOString(),
    startupName: startup?.name ?? null,
    model: estimate?.modelValue ?? evidence.model?.probability ?? estimate?.openingBaseline?.value ?? study.baselineValue ?? null,
    crowd: estimate?.generalPrice ?? null,
    verified: estimate?.specializedPrice ?? null,
    participants: estimate?.participantCount ?? 0,
    history: history.map((p) => ({
      at: p.at.toISOString(),
      modelValue: p.modelValue ?? null,
      yesShare: p.yesShare,
      specializedPrice: p.specializedPrice ?? null,
      totalCredits: p.totalCredits,
      participantCount: p.participantCount,
    })),
    sources: (evidence.model?.inputs ?? []).map((i) => ({
      label: i.label,
      source: i.source,
      url: i.sourceRef?.url ?? null,
      provenance: i.provenance,
      simulated: i.simulated,
    })),
  };
  return ok(preview);
});
