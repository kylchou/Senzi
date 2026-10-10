import {
  COMPARISON_LIMITATIONS,
  MAX_COMPARE,
  MIN_COMPARE,
  computeTrackRecord,
  toCompareQuestion,
} from "../compare";
import { DASHBOARD_MOVEMENT_WINDOW_MS } from "../constants";
import { VcError, forbidden, notFound } from "../errors";
import { shareChangeOverWindow } from "../estimates";
import { getStudyPermissions } from "../permissions";
import type { VcDeps } from "../ports";
import { PUBLISHED_STATUSES, type CompareColumn, type CompareQuestion, type StartupComparison, type VcContext } from "../types";

/** Most open questions per startup whose 7-day history is fetched. */
const HISTORY_CAP_PER_STARTUP = 10;

export function createCompareService(deps: VcDeps) {
  const { repo, platform, forecasting, indicators, now } = deps;

  /**
   * Side-by-side view of 2–4 published startups: their open and resolved
   * questions, track record, and public indicators. Each column only uses data
   * the caller may see: public markets, published PUBLIC studies, and studies
   * their own firm can view.
   */
  async function compare(ctx: VcContext, startupIds: string[]): Promise<StartupComparison> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    if (startupIds.length < MIN_COMPARE || startupIds.length > MAX_COMPARE) {
      throw new VcError("VALIDATION_ERROR", `Choose between ${MIN_COMPARE} and ${MAX_COMPARE} startups to compare`);
    }
    const at = now();

    const startups = await platform.getStartups(startupIds);
    if (startups.length !== startupIds.length) throw notFound("Startup");

    const [markets, orgStudies, publicStudies] = await Promise.all([
      platform.listPublicMarketsForStartups(startupIds),
      repo.listStudies({ organizationId: ctx.activeOrg.organizationId, startupIds, hasMarket: true }),
      repo.listStudies({ visibility: "PUBLIC", statuses: PUBLISHED_STATUSES, startupIds, hasMarket: true }),
    ]);
    const studies = [...new Map([...orgStudies, ...publicStudies].map((s) => [s.id, s])).values()].filter(
      (s) => PUBLISHED_STATUSES.includes(s.status) && getStudyPermissions(ctx, s).canView,
    );

    const marketIds = [...markets.map((m) => m.id), ...studies.map((s) => s.marketId!)];
    const estimates = marketIds.length ? await forecasting.getEstimates(marketIds) : new Map();

    // Recent history for open questions, in parallel, capped per startup.
    const openByStartup = new Map<string, string[]>();
    for (const id of marketIds) {
      const e = estimates.get(id);
      if (e?.status !== "OPEN") continue;
      const startupId = markets.find((m) => m.id === id)?.startupId ?? studies.find((s) => s.marketId === id)?.startupId;
      if (!startupId) continue;
      const list = openByStartup.get(startupId) ?? [];
      if (list.length < HISTORY_CAP_PER_STARTUP) openByStartup.set(startupId, [...list, id]);
    }
    const historyFrom = new Date(at.getTime() - 2 * DASHBOARD_MOVEMENT_WINDOW_MS);
    const changes = new Map(
      await Promise.all(
        [...openByStartup.values()].flat().map(async (id) => {
          const history = await forecasting.getHistory(id, { from: historyFrom });
          return [id, shareChangeOverWindow(history, DASHBOARD_MOVEMENT_WINDOW_MS, at)] as const;
        }),
      ),
    );

    const indicatorResults = await Promise.all(startups.map((s) => indicators.getIndicators(s, at)));

    const byId = new Map(startups.map((s, i) => [s.id, { startup: s, indicators: indicatorResults[i] }]));
    const columns: CompareColumn[] = startupIds.map((id) => {
      const { startup, indicators: ind } = byId.get(id)!;
      const questions: CompareQuestion[] = [
        ...studies
          .filter((s) => s.startupId === id)
          .map((s) =>
            toCompareQuestion(
              // Published study statuses (OPEN / CLOSED / RESOLVED) are also market statuses.
              { id: s.marketId!, question: s.question, status: s.status as CompareQuestion["status"], closesAt: s.deadline },
              estimates.get(s.marketId!),
              s,
              changes.get(s.marketId!) ?? null,
            ),
          ),
        ...markets
          .filter((m) => m.startupId === id)
          .map((m) => toCompareQuestion(m, estimates.get(m.id), null, changes.get(m.id) ?? null)),
      ];
      const byDeadline = (a: CompareQuestion, b: CompareQuestion) =>
        (a.closesAt?.getTime() ?? Infinity) - (b.closesAt?.getTime() ?? Infinity);
      const resolved = questions.filter((q) => q.status === "RESOLVED" || q.outcome !== null);
      return {
        startup,
        open: questions.filter((q) => q.status === "OPEN").sort(byDeadline),
        closed: questions.filter((q) => q.status === "CLOSED" && q.outcome === null).sort(byDeadline),
        resolved,
        trackRecord: computeTrackRecord(resolved),
        indicators: ind,
      };
    });

    return { generatedAt: at, columns, limitations: COMPARISON_LIMITATIONS };
  }

  return { compare };
}

export type CompareService = ReturnType<typeof createCompareService>;
