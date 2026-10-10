import { forbidden, notFound } from "../errors";
import { getStudyPermissions } from "../permissions";
import type { VcDeps } from "../ports";
import { buildStudyReport } from "../reports";
import type { SavedReport, StudyReport, VcContext } from "../types";

export interface SavedReportSummary {
  id: string;
  studyId: string;
  title: string;
  createdById: string;
  createdAt: Date;
  generatedAt: string;
}

export function createReportService(deps: VcDeps) {
  const { repo, platform, forecasting, now } = deps;

  /**
   * Builds a live report. Requires the same "full" access as the study's private
   * workspace, so exports never reveal more than the dashboard.
   */
  async function generate(ctx: VcContext, studyId: string): Promise<StudyReport> {
    const study = await repo.findStudy(studyId);
    if (!study) throw notFound("Study");
    const permissions = getStudyPermissions(ctx, study);
    if (!permissions.canView) throw notFound("Study");
    if (!permissions.canGenerateReports) throw forbidden("Reports are available to the owning firm only");

    const membership = ctx.memberships.find((m) => m.organizationId === study.organizationId)!;
    const [startups, estimates, history, events] = await Promise.all([
      platform.getStartups([study.startupId]),
      study.marketId ? forecasting.getEstimates([study.marketId]) : Promise.resolve(new Map()),
      study.marketId ? forecasting.getHistory(study.marketId) : Promise.resolve([]),
      repo.listEvents(study.id),
    ]);

    return buildStudyReport({
      study,
      organization: { id: membership.organizationId, name: membership.organizationName },
      startup: startups[0] ?? null,
      estimate: study.marketId ? estimates.get(study.marketId) ?? null : null,
      history,
      events,
      now: now(),
    });
  }

  /** Freezes a report snapshot for the firm's records. */
  async function save(ctx: VcContext, studyId: string, title?: string): Promise<SavedReport> {
    const content = await generate(ctx, studyId);
    const membership = ctx.memberships.find((m) => m.organizationId === content.organization.id);
    if (!membership || membership.role === "VIEWER") throw forbidden();
    return repo.createReport({
      organizationId: content.organization.id,
      studyId,
      createdById: ctx.user.id,
      title: title ?? `${content.study.question} — ${content.generatedAt.slice(0, 10)}`,
      content,
    });
  }

  /**
   * Saved reports are re-checked against the study's *current* permissions, so
   * narrowing a study's visibility also hides its historical reports.
   */
  async function canReadReportForStudy(ctx: VcContext, studyId: string) {
    const study = await repo.findStudy(studyId);
    return !!study && getStudyPermissions(ctx, study).canGenerateReports;
  }

  async function list(ctx: VcContext, options: { studyId?: string; limit?: number } = {}): Promise<SavedReportSummary[]> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    const reports = await repo.listReports(ctx.activeOrg.organizationId, {
      studyId: options.studyId,
      limit: options.limit ?? 50,
    });
    const studyIds = [...new Set(reports.map((r) => r.studyId))];
    const studies = studyIds.length ? await repo.listStudies({ ids: studyIds }) : [];
    const allowed = new Set(
      studies.filter((s) => getStudyPermissions(ctx, s).canGenerateReports).map((s) => s.id),
    );
    return reports
      .filter((r) => allowed.has(r.studyId))
      .map((r) => ({
        id: r.id,
        studyId: r.studyId,
        title: r.title,
        createdById: r.createdById,
        createdAt: r.createdAt,
        generatedAt: r.content.generatedAt,
      }));
  }

  async function get(ctx: VcContext, reportId: string): Promise<SavedReport> {
    const report = await repo.findReport(reportId);
    if (
      !report ||
      !ctx.memberships.some((m) => m.organizationId === report.organizationId) ||
      !(await canReadReportForStudy(ctx, report.studyId))
    ) {
      throw notFound("Report");
    }
    return report;
  }

  return { generate, save, list, get };
}

export type ReportService = ReturnType<typeof createReportService>;
