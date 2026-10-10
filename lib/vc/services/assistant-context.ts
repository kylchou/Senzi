import { buildComparisonContext, buildStudyContext } from "../assistant/context";
import { computeTrackRecord } from "../compare";
import type { ContextPackage, DataTier } from "../assistant/types";
import { VcError } from "../errors";
import { redactStudy } from "../permissions";
import type { VcDeps } from "../ports";
import type { VcContext } from "../types";
import type { CompareService } from "./compare";
import type { StudyService } from "./studies";

/**
 * Builds the evidence package for one assistant question. Everything is read
 * through the same permission-checked services as the pages, so the package
 * never holds anything the asker couldn't open themselves. The data tier then
 * narrows it further to what the team has approved sending to an AI provider.
 */
export function createAssistantContextService(
  deps: VcDeps,
  services: { studies: StudyService; compare: CompareService },
  options: { tier: DataTier },
) {
  const { repo, platform, forecasting, indicators, now } = deps;
  const tier = options.tier;

  async function forStudy(ctx: VcContext, studyId: string): Promise<ContextPackage> {
    // NOT_FOUND for anyone who can't view the study, before any data is read.
    const { study, permissions } = await services.studies.loadVisible(ctx, studyId);
    if (study.visibility === "RESTRICTED" && tier !== "extended") {
      throw new VcError("FORBIDDEN", "Restricted studies aren't approved for the AI assistant yet.");
    }
    const at = now();

    const [startups, estimates, history, evidence, notes] = await Promise.all([
      platform.getStartups([study.startupId]),
      study.marketId ? forecasting.getEstimates([study.marketId]) : Promise.resolve(new Map()),
      study.marketId ? forecasting.getHistory(study.marketId) : Promise.resolve([]),
      platform.getStartupEvidence([study.startupId]),
      tier === "extended" && permissions.canViewPrivate ? repo.listNotes(study.id) : Promise.resolve(null),
    ]);
    const startup = startups[0] ?? null;
    const indicatorResult = startup ? await indicators.getIndicators(startup, at) : { status: "not_tracked" as const, rows: [] };

    return buildStudyContext({
      // Limited viewers get the same redacted view the page shows them.
      study: redactStudy(ctx, study, permissions),
      startup,
      estimate: study.marketId ? estimates.get(study.marketId) ?? null : null,
      history,
      facts: evidence.facts,
      news: evidence.news,
      indicators: indicatorResult,
      notes,
      notesOmittedReason: notes
        ? null
        : tier !== "extended"
          ? "Private firm notes aren't approved for the AI assistant."
          : permissions.canViewPrivate
            ? null
            : "Private notes are only available to the owning firm.",
      tier,
      now: at,
    });
  }

  async function forComparison(ctx: VcContext, startupIds: string[]): Promise<ContextPackage> {
    // Already limited to public markets, published PUBLIC studies, and studies the firm can view.
    const comparison = await services.compare.compare(ctx, startupIds);

    let restrictedQuestionsOmitted = 0;
    if (tier !== "extended") {
      const studyIds = comparison.columns.flatMap((c) => [...c.open, ...c.closed, ...c.resolved]).map((q) => q.studyId).filter((id): id is string => !!id);
      const studies = studyIds.length ? await repo.listStudies({ ids: studyIds }) : [];
      const restricted = new Set(studies.filter((s) => s.visibility === "RESTRICTED").map((s) => s.id));
      const keep = (q: { studyId: string | null }) => !q.studyId || !restricted.has(q.studyId);
      for (const col of comparison.columns) {
        const before = col.open.length + col.closed.length + col.resolved.length;
        col.open = col.open.filter(keep);
        col.closed = col.closed.filter(keep);
        col.resolved = col.resolved.filter(keep);
        // Recompute so counts and scores don't reflect the removed questions.
        col.trackRecord = computeTrackRecord(col.resolved);
        restrictedQuestionsOmitted += before - (col.open.length + col.closed.length + col.resolved.length);
      }
    }

    const evidence = await platform.getStartupEvidence(comparison.columns.map((c) => c.startup.id));
    return buildComparisonContext({
      comparison,
      facts: evidence.facts,
      news: evidence.news,
      restrictedQuestionsOmitted,
      tier,
      now: comparison.generatedAt,
    });
  }

  return { tier, forStudy, forComparison };
}

export type AssistantContextService = ReturnType<typeof createAssistantContextService>;
