import { forbidden, notFound } from "../errors";
import { canProposeInActiveOrg, getStudyPermissions, redactStudy, type StudyView } from "../permissions";
import type { VcDeps } from "../ports";
import {
  PUBLISHED_STATUSES,
  type CompareIndicators,
  type MarketEstimate,
  type MarketSummary,
  type StartupSummary,
  type Study,
  type VcContext,
  type Watchlist,
} from "../types";
import type { WatchlistItemInput } from "../validation";

/**
 * Following, without list management. Each firm has one list behind the
 * scenes (created on first follow) that alerts read from; older named lists
 * still count, so following is the union of all of a firm's lists.
 */
export const DEFAULT_WATCHLIST_NAME = "Following";

/** An open market on a startup that this firm can see. */
export type OpenMarketRow =
  | { kind: "market"; market: MarketSummary; estimate: MarketEstimate | null }
  | { kind: "study"; study: StudyView; estimate: MarketEstimate | null };

/** Everything the watchlist page shows for one startup. */
export interface StartupWatch {
  startup: StartupSummary;
  following: boolean;
  /** Scraped public indicators (downloads, repositories, hiring, filings). */
  indicators: CompareIndicators;
  openMarkets: OpenMarketRow[];
}

export interface WatchOverview {
  /** False for viewers: they can see but not follow or unfollow. */
  canEdit: boolean;
  /** The startup picked in search, if any. */
  selected: StartupWatch | null;
  followed: StartupWatch[];
  followedStudies: { study: StudyView; estimate: MarketEstimate | null }[];
}

export function createWatchlistService(deps: VcDeps) {
  const { repo, platform, forecasting, indicators, now } = deps;

  function requireOrg(ctx: VcContext) {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    return ctx.activeOrg;
  }

  function requireEditor(ctx: VcContext) {
    const org = requireOrg(ctx);
    if (!canProposeInActiveOrg(ctx)) throw forbidden("Your role can't change what your firm follows");
    return org;
  }

  /** The firm's hidden default list, created on first use. */
  async function defaultWatchlist(ctx: VcContext): Promise<Watchlist> {
    const org = requireOrg(ctx);
    const find = async () => (await repo.listWatchlists(org.organizationId)).find((w) => w.name === DEFAULT_WATCHLIST_NAME);
    const existing = await find();
    if (existing) return existing;
    const created = await repo.createWatchlist({ organizationId: org.organizationId, name: DEFAULT_WATCHLIST_NAME, createdById: ctx.user.id });
    // Null means a concurrent request created it first.
    return created ?? (await find())!;
  }

  const matches = (item: { type: string; startupId: string | null; studyId: string | null }, target: WatchlistItemInput) =>
    target.type === "STARTUP" ? item.type === "STARTUP" && item.startupId === target.startupId : item.type === "STUDY" && item.studyId === target.studyId;

  async function follow(ctx: VcContext, target: WatchlistItemInput): Promise<void> {
    const org = requireEditor(ctx);
    if (target.type === "STUDY") {
      const study = await repo.findStudy(target.studyId);
      // Only studies this user can see may be followed; others look nonexistent.
      if (!study || !getStudyPermissions(ctx, study).canView) throw notFound("Study");
    } else {
      const [startup] = await platform.getStartups([target.startupId]);
      if (!startup) throw notFound("Startup");
    }
    const lists = await repo.listWatchlists(org.organizationId);
    if (lists.some((w) => w.items.some((i) => matches(i, target)))) return;
    const list = await defaultWatchlist(ctx);
    await repo.addWatchlistItem({
      watchlistId: list.id,
      type: target.type,
      startupId: target.type === "STARTUP" ? target.startupId : null,
      studyId: target.type === "STUDY" ? target.studyId : null,
      addedById: ctx.user.id,
    });
  }

  async function unfollow(ctx: VcContext, target: WatchlistItemInput): Promise<void> {
    const org = requireEditor(ctx);
    const lists = await repo.listWatchlists(org.organizationId);
    for (const w of lists) {
      for (const item of w.items.filter((i) => matches(i, target))) await repo.removeWatchlistItem(w.id, item.id);
    }
  }

  /** Whether the firm follows this; null when the caller can't follow things. */
  async function isFollowing(ctx: VcContext, target: WatchlistItemInput): Promise<boolean | null> {
    if (!ctx.activeOrg || !canProposeInActiveOrg(ctx)) return null;
    const lists = await repo.listWatchlists(ctx.activeOrg.organizationId);
    return lists.some((w) => w.items.some((i) => matches(i, target)));
  }

  /** Open markets on these startups that the caller can see, grouped by startup. */
  async function openMarketsFor(ctx: VcContext, startupIds: string[]): Promise<Map<string, OpenMarketRow[]>> {
    const byStartup = new Map<string, OpenMarketRow[]>(startupIds.map((id) => [id, []]));
    if (startupIds.length === 0) return byStartup;
    const org = ctx.activeOrg;
    const [markets, orgStudies, publicStudies] = await Promise.all([
      // Excludes every market opened from a study (any firm's): those appear through their study.
      platform.listPublicMarketsForStartups(startupIds),
      org ? repo.listStudies({ organizationId: org.organizationId, startupIds, statuses: ["OPEN"], hasMarket: true }) : Promise.resolve([]),
      repo.listStudies({ visibility: "PUBLIC", statuses: PUBLISHED_STATUSES, startupIds, hasMarket: true }),
    ]);
    const studies = [...new Map([...orgStudies, ...publicStudies].map((s) => [s.id, s])).values()]
      .filter((s) => s.status === "OPEN")
      .map((s) => ({ raw: s, permissions: getStudyPermissions(ctx, s) }))
      .filter(({ permissions }) => permissions.canView);
    const openPublic = markets.filter((m) => m.status === "OPEN");
    const ids = [...studies.map((s) => s.raw.marketId!), ...openPublic.map((m) => m.id)];
    const estimates = ids.length ? await forecasting.getEstimates(ids) : new Map<string, MarketEstimate>();

    for (const { raw, permissions } of studies) {
      byStartup.get(raw.startupId)?.push({ kind: "study", study: redactStudy(ctx, raw, permissions), estimate: estimates.get(raw.marketId!) ?? null });
    }
    for (const market of openPublic) {
      byStartup.get(market.startupId)?.push({ kind: "market", market, estimate: estimates.get(market.id) ?? null });
    }
    return byStartup;
  }

  async function watchesFor(ctx: VcContext, startups: StartupSummary[], followedIds: Set<string>): Promise<StartupWatch[]> {
    const [markets, indicatorRows] = await Promise.all([
      openMarketsFor(ctx, startups.map((s) => s.id)),
      Promise.all(startups.map((s) => indicators.getIndicators(s, now()))),
    ]);
    return startups.map((startup, i) => ({
      startup,
      following: followedIds.has(startup.id),
      indicators: indicatorRows[i]!,
      openMarkets: markets.get(startup.id) ?? [],
    }));
  }

  /** The watchlist page: what the firm follows, plus the startup picked in search. */
  async function overview(ctx: VcContext, selectedStartupId?: string | null): Promise<WatchOverview> {
    const org = requireOrg(ctx);
    const lists = await repo.listWatchlists(org.organizationId);
    const items = lists.flatMap((w) => w.items);
    const followedStartupIds = [...new Set(items.filter((i) => i.type === "STARTUP").map((i) => i.startupId!))];
    const followedStudyIds = [...new Set(items.filter((i) => i.type === "STUDY").map((i) => i.studyId!))];

    const lookup = [...new Set([...followedStartupIds, ...(selectedStartupId ? [selectedStartupId] : [])])];
    const [startups, studies] = await Promise.all([
      lookup.length ? platform.getStartups(lookup) : Promise.resolve([]),
      followedStudyIds.length ? repo.listStudies({ ids: followedStudyIds }) : Promise.resolve([] as Study[]),
    ]);
    const followedSet = new Set(followedStartupIds);
    const watches = await watchesFor(ctx, startups, followedSet);
    const byId = new Map(watches.map((w) => [w.startup.id, w]));

    const visibleStudies = studies
      .map((s) => ({ raw: s, permissions: getStudyPermissions(ctx, s) }))
      .filter(({ permissions }) => permissions.canView);
    const studyMarketIds = visibleStudies.map((s) => s.raw.marketId).filter((id): id is string => !!id);
    const studyEstimates = studyMarketIds.length ? await forecasting.getEstimates(studyMarketIds) : new Map<string, MarketEstimate>();

    return {
      canEdit: canProposeInActiveOrg(ctx),
      selected: selectedStartupId ? (byId.get(selectedStartupId) ?? null) : null,
      followed: followedStartupIds.map((id) => byId.get(id)).filter((w): w is StartupWatch => !!w),
      followedStudies: visibleStudies.map(({ raw, permissions }) => ({
        study: redactStudy(ctx, raw, permissions),
        estimate: raw.marketId ? (studyEstimates.get(raw.marketId) ?? null) : null,
      })),
    };
  }

  return { follow, unfollow, isFollowing, overview };
}

export type WatchlistService = ReturnType<typeof createWatchlistService>;
