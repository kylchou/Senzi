import {
  DEADLINE_ALERT_WINDOW_MS,
  MIN_PARTICIPANTS_FOR_MOVEMENT,
  MOVEMENT_ALERT_THRESHOLD,
  MOVEMENT_WINDOW_MS,
} from "../constants";
import { forbidden } from "../errors";
import { formatPointChange, formatShare, shareChangeOverWindow } from "../estimates";
import { getStudyPermissions, organizationCanFollowStudy } from "../permissions";
import type { NewAlert, VcDeps } from "../ports";
import type { AlertType, EstimatePoint, MarketEstimate, Study, VcAlert, VcContext } from "../types";

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

interface Subject {
  kind: "study" | "market";
  id: string;
  marketId: string | null;
  startupId: string;
  question: string;
  status: "OPEN" | "OTHER" | "RESOLVED";
  closesAt: Date | null;
  study?: Study;
}

/** Pure alert rules for one followed subject. Exported for tests. */
export function alertsForSubject(
  organizationId: string,
  subject: Subject,
  estimate: MarketEstimate | null,
  history: EstimatePoint[],
  now: Date,
): NewAlert[] {
  const alerts: NewAlert[] = [];
  const base = {
    organizationId,
    studyId: subject.kind === "study" ? subject.id : null,
    startupId: subject.startupId,
    marketId: subject.marketId,
  };

  if (subject.status === "OPEN" && estimate && estimate.participantCount >= MIN_PARTICIPANTS_FOR_MOVEMENT) {
    const change = shareChangeOverWindow(history, MOVEMENT_WINDOW_MS, now);
    if (change != null && Math.abs(change) >= MOVEMENT_ALERT_THRESHOLD) {
      alerts.push({
        ...base,
        type: "FORECAST_MOVEMENT",
        title: `Community allocation share moved ${formatPointChange(change)} in 24h`,
        body: `${subject.question} — YES allocation share now ${formatShare(estimate.allocation.yesShare)} across ${estimate.participantCount} participants. This is a credit-allocation share, not a calibrated probability.`,
        payload: {
          change,
          yesShare: estimate.allocation.yesShare,
          participantCount: estimate.participantCount,
        },
        dedupeKey: `movement:${subject.kind}:${subject.id}:${dayKey(now)}`,
      });
    }
  }

  if (subject.status === "OPEN" && subject.closesAt) {
    const remaining = subject.closesAt.getTime() - now.getTime();
    if (remaining > 0 && remaining <= DEADLINE_ALERT_WINDOW_MS) {
      alerts.push({
        ...base,
        type: "DEADLINE_APPROACHING",
        title: "Forecast deadline within 3 days",
        body: subject.question,
        payload: { closesAt: subject.closesAt.toISOString() },
        dedupeKey: `deadline:${subject.kind}:${subject.id}`,
      });
    }
  }

  // Owners already receive resolution alerts from the lifecycle transition.
  if (subject.status === "RESOLVED" && subject.study && subject.study.organizationId !== organizationId) {
    alerts.push({
      ...base,
      type: "STUDY_RESOLVED",
      title: `Followed study resolved: ${subject.study.resolvedOutcome ?? "outcome recorded"}`,
      body: subject.question,
      payload: { outcome: subject.study.resolvedOutcome },
      dedupeKey: `resolved:study:${subject.id}`,
    });
  }
  return alerts;
}

export function createAlertService(deps: VcDeps) {
  const { repo, platform, forecasting, now } = deps;

  /**
   * Generates alerts for every organization's followed studies and startups.
   * Idempotent per (organization, dedupeKey); intended for a scheduled job.
   */
  async function evaluate(): Promise<{ created: number }> {
    const at = now();
    const [watchlists, openStudies] = await Promise.all([
      repo.listAllWatchlists(),
      repo.listStudies({ statuses: ["OPEN"], hasMarket: true }),
    ]);

    const followedStudies = new Map<string, Set<string>>(); // orgId -> studyIds
    const followedStartups = new Map<string, Set<string>>(); // orgId -> startupIds
    const add = (m: Map<string, Set<string>>, org: string, id: string) =>
      (m.get(org) ?? m.set(org, new Set()).get(org)!).add(id);

    for (const s of openStudies) add(followedStudies, s.organizationId, s.id);
    for (const w of watchlists) {
      for (const item of w.items) {
        if (item.type === "STUDY" && item.studyId) add(followedStudies, w.organizationId, item.studyId);
        if (item.type === "STARTUP" && item.startupId) add(followedStartups, w.organizationId, item.startupId);
      }
    }

    const allStudyIds = [...new Set([...followedStudies.values()].flatMap((s) => [...s]))];
    const studies = allStudyIds.length ? await repo.listStudies({ ids: allStudyIds }) : [];
    const studyById = new Map(studies.map((s) => [s.id, s]));

    const allStartupIds = [...new Set([...followedStartups.values()].flatMap((s) => [...s]))];
    const markets = allStartupIds.length ? await platform.listPublicMarketsForStartups(allStartupIds) : [];

    const marketIds = [
      ...studies.filter((s) => s.status === "OPEN").map((s) => s.marketId),
      ...markets.filter((m) => m.status === "OPEN").map((m) => m.id),
    ].filter((id): id is string => !!id);
    const estimates = marketIds.length ? await forecasting.getEstimates(marketIds) : new Map();

    const historyCache = new Map<string, Promise<EstimatePoint[]>>();
    const historyFor = (marketId: string) => {
      if (!historyCache.has(marketId)) {
        historyCache.set(
          marketId,
          forecasting.getHistory(marketId, { from: new Date(at.getTime() - 2 * MOVEMENT_WINDOW_MS) }),
        );
      }
      return historyCache.get(marketId)!;
    };

    const pending: NewAlert[] = [];
    for (const [orgId, ids] of followedStudies) {
      for (const id of ids) {
        const study = studyById.get(id);
        if (!study || !organizationCanFollowStudy(orgId, study)) continue;
        const estimate = study.marketId ? estimates.get(study.marketId) ?? null : null;
        const history = study.status === "OPEN" && study.marketId ? await historyFor(study.marketId) : [];
        pending.push(
          ...alertsForSubject(
            orgId,
            {
              kind: "study",
              id: study.id,
              marketId: study.marketId,
              startupId: study.startupId,
              question: study.question,
              status: study.status === "OPEN" ? "OPEN" : study.status === "RESOLVED" ? "RESOLVED" : "OTHER",
              closesAt: study.deadline,
              study,
            },
            estimate,
            history,
            at,
          ),
        );
      }
    }

    for (const [orgId, startupIds] of followedStartups) {
      for (const market of markets) {
        if (!startupIds.has(market.startupId) || market.status !== "OPEN") continue;
        const estimate = estimates.get(market.id) ?? null;
        pending.push(
          ...alertsForSubject(
            orgId,
            {
              kind: "market",
              id: market.id,
              marketId: market.id,
              startupId: market.startupId,
              question: market.question,
              status: "OPEN",
              closesAt: market.closesAt,
            },
            estimate,
            await historyFor(market.id),
            at,
          ),
        );
      }
    }

    const created = pending.length ? await repo.createAlerts(pending) : 0;
    return { created };
  }

  /** Drops alerts about studies the current user can no longer see (e.g. restricted studies). */
  async function filterVisible(ctx: VcContext, alerts: VcAlert[]): Promise<VcAlert[]> {
    const studyIds = [...new Set(alerts.map((a) => a.studyId).filter((id): id is string => !!id))];
    const studies = studyIds.length ? await repo.listStudies({ ids: studyIds }) : [];
    const visible = new Set(studies.filter((s) => getStudyPermissions(ctx, s).canView).map((s) => s.id));
    return alerts.filter((a) => !a.studyId || visible.has(a.studyId));
  }

  async function list(
    ctx: VcContext,
    options: { unreadOnly?: boolean; type?: AlertType; limit: number },
  ): Promise<VcAlert[]> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    const alerts = await repo.listAlerts(ctx.activeOrg.organizationId, ctx.user.id, options);
    return filterVisible(ctx, alerts);
  }

  async function unreadCount(ctx: VcContext): Promise<number> {
    if (!ctx.activeOrg) return 0;
    const unread = await list(ctx, { unreadOnly: true, limit: 200 });
    return unread.length;
  }

  async function markRead(ctx: VcContext, alertIds: string[]): Promise<void> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    // Scoped to the active org in the repository, so foreign IDs are ignored.
    await repo.markAlertsRead(ctx.activeOrg.organizationId, ctx.user.id, alertIds, now());
  }

  return { evaluate, list, unreadCount, markRead };
}

export type AlertService = ReturnType<typeof createAlertService>;
