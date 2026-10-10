import { VcError, forbidden, notFound } from "../errors";
import { canProposeInActiveOrg, getStudyPermissions, redactStudy, type StudyView } from "../permissions";
import type { VcDeps } from "../ports";
import {
  PUBLISHED_STATUSES,
  type MarketEstimate,
  type MarketSummary,
  type StartupSummary,
  type Watchlist,
  type WatchlistItem,
  type VcContext,
} from "../types";
import type { WatchlistItemInput } from "../validation";

export interface WatchlistStudyEntry {
  item: WatchlistItem;
  kind: "STUDY";
  study: StudyView | null; // null when the study is no longer visible to this user
  estimate: MarketEstimate | null;
}

export interface WatchlistStartupEntry {
  item: WatchlistItem;
  kind: "STARTUP";
  startup: StartupSummary | null;
  /** Public markets not opened from a study, plus visible studies about the startup (this firm's and published public ones). */
  markets: { market: MarketSummary; estimate: MarketEstimate | null }[];
  studies: { study: StudyView; estimate: MarketEstimate | null }[];
}

export interface WatchlistDetail {
  watchlist: Omit<Watchlist, "items">;
  entries: (WatchlistStudyEntry | WatchlistStartupEntry)[];
}

export function createWatchlistService(deps: VcDeps) {
  const { repo, platform, forecasting } = deps;

  function requireOrg(ctx: VcContext) {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    return ctx.activeOrg;
  }

  async function loadOwned(ctx: VcContext, watchlistId: string) {
    const org = requireOrg(ctx);
    const watchlist = await repo.findWatchlist(watchlistId);
    if (!watchlist || watchlist.organizationId !== org.organizationId) throw notFound("Watchlist");
    return watchlist;
  }

  async function list(ctx: VcContext): Promise<WatchlistDetail[]> {
    const org = requireOrg(ctx);
    const watchlists = await repo.listWatchlists(org.organizationId);
    const items = watchlists.flatMap((w) => w.items);

    const studyIds = items.filter((i) => i.type === "STUDY").map((i) => i.studyId!);
    const startupIds = [...new Set(items.filter((i) => i.type === "STARTUP").map((i) => i.startupId!))];

    const [watchedStudies, startups, markets, orgStartupStudies, publicStartupStudies] = await Promise.all([
      studyIds.length ? repo.listStudies({ ids: studyIds }) : Promise.resolve([]),
      startupIds.length ? platform.getStartups(startupIds) : Promise.resolve([]),
      // Excludes every market opened from a study (any firm's): those appear through their study.
      startupIds.length ? platform.listPublicMarketsForStartups(startupIds) : Promise.resolve([]),
      startupIds.length
        ? repo.listStudies({ organizationId: org.organizationId, startupIds, hasMarket: true })
        : Promise.resolve([]),
      startupIds.length
        ? repo.listStudies({ visibility: "PUBLIC", statuses: PUBLISHED_STATUSES, startupIds, hasMarket: true })
        : Promise.resolve([]),
    ]);

    const startupStudies = [
      ...new Map([...orgStartupStudies, ...publicStartupStudies].map((s) => [s.id, s])).values(),
    ];
    const visibleStudies = new Map(
      [...watchedStudies, ...startupStudies]
        .map((s) => ({ s, p: getStudyPermissions(ctx, s) }))
        .filter(({ p }) => p.canView)
        .map(({ s, p }) => [s.id, { raw: s, view: redactStudy(ctx, s, p) }]),
    );

    const marketIds = [
      ...[...visibleStudies.values()].map((s) => s.raw.marketId),
      ...markets.map((m) => m.id),
    ].filter((id): id is string => !!id);
    const estimates = marketIds.length ? await forecasting.getEstimates(marketIds) : new Map();
    const startupById = new Map(startups.map((s) => [s.id, s]));
    const estimateFor = (marketId: string | null) => (marketId ? estimates.get(marketId) ?? null : null);

    return watchlists.map((w) => {
      const { items: wItems, ...watchlist } = w;
      return {
        watchlist,
        entries: wItems.map((item): WatchlistStudyEntry | WatchlistStartupEntry => {
          if (item.type === "STUDY") {
            const s = visibleStudies.get(item.studyId!);
            return {
              item,
              kind: "STUDY",
              study: s?.view ?? null,
              estimate: s ? estimateFor(s.raw.marketId) : null,
            };
          }
          return {
            item,
            kind: "STARTUP",
            startup: startupById.get(item.startupId!) ?? null,
            markets: markets
              .filter((m) => m.startupId === item.startupId)
              .map((market) => ({ market, estimate: estimateFor(market.id) })),
            studies: startupStudies
              .filter((s) => s.startupId === item.startupId && visibleStudies.has(s.id))
              .map((s) => ({ study: visibleStudies.get(s.id)!.view, estimate: estimateFor(s.marketId) })),
          };
        }),
      };
    });
  }

  async function create(ctx: VcContext, name: string) {
    const org = requireOrg(ctx);
    if (!canProposeInActiveOrg(ctx)) throw forbidden();
    const created = await repo.createWatchlist({
      organizationId: org.organizationId,
      name,
      createdById: ctx.user.id,
    });
    if (!created) throw new VcError("CONFLICT", "A watchlist with that name already exists");
    return created;
  }

  async function remove(ctx: VcContext, watchlistId: string) {
    await loadOwned(ctx, watchlistId);
    if (!canProposeInActiveOrg(ctx)) throw forbidden();
    await repo.deleteWatchlist(watchlistId);
  }

  async function addItem(ctx: VcContext, watchlistId: string, input: WatchlistItemInput) {
    await loadOwned(ctx, watchlistId);
    if (!canProposeInActiveOrg(ctx)) throw forbidden();

    if (input.type === "STUDY") {
      const study = await repo.findStudy(input.studyId);
      // Only studies this user can see may be followed; others look nonexistent.
      if (!study || !getStudyPermissions(ctx, study).canView) throw notFound("Study");
      return repo.addWatchlistItem({
        watchlistId,
        type: "STUDY",
        studyId: study.id,
        startupId: null,
        addedById: ctx.user.id,
      });
    }

    const [startup] = await platform.getStartups([input.startupId]);
    if (!startup) throw notFound("Startup");
    return repo.addWatchlistItem({
      watchlistId,
      type: "STARTUP",
      startupId: startup.id,
      studyId: null,
      addedById: ctx.user.id,
    });
  }

  async function removeItem(ctx: VcContext, watchlistId: string, itemId: string) {
    await loadOwned(ctx, watchlistId);
    if (!canProposeInActiveOrg(ctx)) throw forbidden();
    const removed = await repo.removeWatchlistItem(watchlistId, itemId);
    if (!removed) throw notFound("Watchlist item");
  }

  /** Watchlist names for "Add to watchlist" pickers; null if the caller can't edit watchlists. */
  async function listForPicker(ctx: VcContext): Promise<{ id: string; name: string }[] | null> {
    if (!ctx.activeOrg || !canProposeInActiveOrg(ctx)) return null;
    const watchlists = await repo.listWatchlists(ctx.activeOrg.organizationId);
    return watchlists.map((w) => ({ id: w.id, name: w.name }));
  }

  return { list, listForPicker, create, remove, addItem, removeItem };
}

export type WatchlistService = ReturnType<typeof createWatchlistService>;
