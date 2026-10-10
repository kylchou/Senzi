import {
  DASHBOARD_DEADLINE_WINDOW_MS,
  DASHBOARD_MOVEMENT_WINDOW_MS,
  MOVEMENT_DASHBOARD_THRESHOLD,
} from "../constants";
import { forbidden } from "../errors";
import {
  describeFreshness,
  hasMeaningfulParticipation,
  resolveBaseline,
  shareChangeOverWindow,
  type BaselineView,
  type Freshness,
} from "../estimates";
import { getStudyPermissions, redactStudy, type StudyView } from "../permissions";
import type { VcDeps } from "../ports";
import { ALERT_TYPES, type AlertType, type MarketEstimate, type StudyStatus, type VcAlert, type VcContext } from "../types";
import type { AlertService } from "./alerts";
import type { ReportService, SavedReportSummary } from "./reports";

export interface DashboardStudyRow {
  study: StudyView;
  startupName: string | null;
  /** For linking to the company hub. */
  startupSlug: string | null;
  baseline: BaselineView;
  estimate: MarketEstimate | null;
  freshness: Freshness;
  /** Change in crowd price over the last 7 days. */
  change7d: number | null;
  followed: boolean;
}

export interface VcDashboard {
  organization: { id: string; name: string; role: string };
  generatedAt: Date;
  statusCounts: Partial<Record<StudyStatus, number>>;
  activeStudies: DashboardStudyRow[];
  pipeline: DashboardStudyRow[];
  movements: DashboardStudyRow[];
  upcomingDeadlines: DashboardStudyRow[];
  /** What the firm follows: startup names, and how many questions. */
  following: { startups: { id: string; name: string }[]; studyCount: number };
  recentReports: SavedReportSummary[];
  unreadAlerts: number;
  /** Latest unread alerts the user can see, and unread counts per alert type. */
  alertSummary: { recent: VcAlert[]; unreadByType: Record<AlertType, number> };
}

/** Max studies whose history is fetched for movement detection per dashboard load. */
const MOVEMENT_HISTORY_CAP = 25;

export function createDashboardService(
  deps: VcDeps,
  services: { alerts: AlertService; reports: ReportService },
) {
  const { repo, platform, forecasting, now } = deps;

  async function get(ctx: VcContext): Promise<VcDashboard> {
    const org = ctx.activeOrg;
    if (!org) throw forbidden("Select a VC organization first");
    const at = now();

    const [orgStudies, watchlists] = await Promise.all([
      repo.listStudies({ organizationId: org.organizationId }),
      repo.listWatchlists(org.organizationId),
    ]);
    const watchedIds = new Set(
      watchlists.flatMap((w) => w.items.filter((i) => i.type === "STUDY").map((i) => i.studyId!)),
    );
    const orgIds = new Set(orgStudies.map((s) => s.id));
    const watchedForeign = [...watchedIds].filter((id) => !orgIds.has(id));
    const foreignStudies = watchedForeign.length ? await repo.listStudies({ ids: watchedForeign }) : [];

    const visible = [...orgStudies, ...foreignStudies]
      .map((s) => ({ s, p: getStudyPermissions(ctx, s) }))
      .filter(({ p }) => p.canView);

    const statusCounts: Partial<Record<StudyStatus, number>> = {};
    for (const { s } of visible) {
      if (s.organizationId === org.organizationId) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
    }

    const marketIds = visible.map(({ s }) => s.marketId).filter((id): id is string => !!id);
    const [estimates, startups] = await Promise.all([
      marketIds.length ? forecasting.getEstimates(marketIds) : Promise.resolve(new Map<string, MarketEstimate>()),
      platform.getStartups([...new Set(visible.map(({ s }) => s.startupId))]),
    ]);
    const startupName = new Map(startups.map((s) => [s.id, s.name]));
    const startupSlug = new Map(startups.map((s) => [s.id, s.slug]));

    const openWithMarket = visible
      .filter(({ s }) => s.status === "OPEN" && s.marketId)
      .slice(0, MOVEMENT_HISTORY_CAP);
    const historyFrom = new Date(at.getTime() - 2 * DASHBOARD_MOVEMENT_WINDOW_MS);
    const histories = new Map(
      await Promise.all(
        openWithMarket.map(
          async ({ s }) => [s.id, await forecasting.getHistory(s.marketId!, { from: historyFrom })] as const,
        ),
      ),
    );

    const rows: DashboardStudyRow[] = visible.map(({ s, p }) => {
      const estimate = s.marketId ? estimates.get(s.marketId) ?? null : null;
      const history = histories.get(s.id);
      return {
        study: redactStudy(ctx, s, p),
        startupName: startupName.get(s.startupId) ?? null,
        startupSlug: startupSlug.get(s.startupId) ?? null,
        baseline: resolveBaseline(s, estimate),
        estimate,
        freshness: describeFreshness(estimate, s.status, at),
        change7d: history ? shareChangeOverWindow(history, DASHBOARD_MOVEMENT_WINDOW_MS, at) : null,
        followed: watchedIds.has(s.id),
      };
    });
    const isOwn = (r: DashboardStudyRow) => r.study.organizationId === org.organizationId;
    const byDeadline = (a: DashboardStudyRow, b: DashboardStudyRow) =>
      a.study.deadline.getTime() - b.study.deadline.getTime();

    const activeStudies = rows.filter((r) => r.study.status === "OPEN").sort(byDeadline);
    const pipeline = rows
      .filter((r) => isOwn(r) && ["DRAFT", "SUBMITTED", "APPROVED"].includes(r.study.status))
      .sort((a, b) => b.study.updatedAt.getTime() - a.study.updatedAt.getTime());
    const movements = rows
      .filter(
        (r) =>
          r.change7d != null &&
          Math.abs(r.change7d) >= MOVEMENT_DASHBOARD_THRESHOLD &&
          hasMeaningfulParticipation(r.estimate),
      )
      .sort((a, b) => Math.abs(b.change7d!) - Math.abs(a.change7d!))
      .slice(0, 10);
    const upcomingDeadlines = activeStudies
      .filter((r) => {
        const remaining = r.study.deadline.getTime() - at.getTime();
        return remaining > 0 && remaining <= DASHBOARD_DEADLINE_WINDOW_MS;
      })
      .slice(0, 10);

    const [recentReports, unreadAlerts, unreadList] = await Promise.all([
      services.reports.list(ctx, { limit: 5 }),
      services.alerts.unreadCount(ctx),
      services.alerts.list(ctx, { unreadOnly: true, limit: 100 }),
    ]);

    const followedStartupIds = [
      ...new Set(watchlists.flatMap((w) => w.items.filter((i) => i.type === "STARTUP").map((i) => i.startupId!))),
    ];
    const followedStartups = followedStartupIds.length ? await platform.getStartups(followedStartupIds) : [];

    return {
      organization: { id: org.organizationId, name: org.organizationName, role: org.role },
      generatedAt: at,
      statusCounts,
      activeStudies,
      pipeline,
      movements,
      upcomingDeadlines,
      following: { startups: followedStartups.map((s) => ({ id: s.id, name: s.name })), studyCount: watchedIds.size },
      recentReports,
      unreadAlerts,
      alertSummary: {
        recent: unreadList.slice(0, 5),
        unreadByType: Object.fromEntries(
          ALERT_TYPES.map((t) => [t, unreadList.filter((a) => a.type === t).length]),
        ) as Record<AlertType, number>,
      },
    };
  }

  return { get };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
