/**
 * In-memory implementations of the VC ports for unit tests and local
 * prototyping. Behavior mirrors the Prisma repository (compare-and-set
 * versions, alert dedupe, idempotent watchlist items).
 */
import type { CreatedAlert, PersonalNotification } from "../alert-delivery";
import type { ForecastingGateway, IndicatorGateway, NewAlert, PlatformGateway, VcDeps, VcRepository } from "../ports";
import type {
  CompareIndicators,
  StartupFactView,
  StartupNewsView,
  EstimatePoint,
  MarketEstimate,
  MarketSummary,
  OrgMembership,
  SavedReport,
  SessionUser,
  StartupSummary,
  Study,
  StudyEvent,
  StudyNote,
  UserSummary,
  VcAlert,
  Watchlist,
  WatchlistItem,
} from "../types";

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

export function createMemoryRepository(now: () => Date = () => new Date()): VcRepository & {
  studies: Map<string, Study>;
  events: StudyEvent[];
  alerts: (Omit<VcAlert, "readAt">)[];
  receipts: Map<string, Date>;
} {
  const studies = new Map<string, Study>();
  const events: StudyEvent[] = [];
  const notes = new Map<string, StudyNote>();
  const watchlists = new Map<string, Watchlist>();
  const alerts: Omit<VcAlert, "readAt">[] = [];
  const receipts = new Map<string, Date>(); // `${alertId}:${userId}`
  const reports = new Map<string, SavedReport>();
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    studies,
    events,
    alerts,
    receipts,

    async findStudy(id) {
      const s = studies.get(id);
      return s ? clone(s) : null;
    },
    async findStudyByMarketId(marketId) {
      const s = [...studies.values()].find((x) => x.marketId === marketId);
      return s ? clone(s) : null;
    },
    async listStudies(f) {
      let list = [...studies.values()];
      if (f.organizationId) list = list.filter((s) => s.organizationId === f.organizationId);
      if (f.visibility) list = list.filter((s) => s.visibility === f.visibility);
      if (f.statuses) list = list.filter((s) => f.statuses!.includes(s.status));
      if (f.ids) list = list.filter((s) => f.ids!.includes(s.id));
      if (f.startupIds) list = list.filter((s) => f.startupIds!.includes(s.startupId));
      if (f.hasMarket) list = list.filter((s) => !!s.marketId);
      if (f.resolvedSince) list = list.filter((s) => !!s.resolvedAt && s.resolvedAt >= f.resolvedSince!);
      if (f.participantUserId) list = list.filter((s) => s.participantIds.includes(f.participantUserId!));
      return clone(list.slice(0, f.limit ?? list.length));
    },
    async createStudy(data) {
      const at = now();
      const study: Study = {
        ...data,
        id: nextId("study"),
        marketId: null,
        status: "DRAFT",
        rejectionReason: null,
        cancellationReason: null,
        submittedAt: null,
        approvedAt: null,
        openedAt: null,
        closedAt: null,
        resolvedAt: null,
        resolvedOutcome: null,
        version: 1,
        createdAt: at,
        updatedAt: at,
        sources: data.sources.map((s) => ({ ...s, id: nextId("src") })),
        participantIds: [],
      };
      studies.set(study.id, study);
      events.push({
        id: nextId("evt"),
        studyId: study.id,
        actorId: data.createdById,
        action: "create",
        fromStatus: null,
        toStatus: "DRAFT",
        reason: null,
        createdAt: at,
      });
      return clone(study);
    },
    async updateStudy(id, expectedVersion, patch, event) {
      const current = studies.get(id);
      if (!current || current.version !== expectedVersion) return null;
      const { sources, ...fields } = patch;
      const updated: Study = {
        ...current,
        ...fields,
        ...(sources && { sources: sources.map((s) => ({ ...s, id: nextId("src") })) }),
        version: current.version + 1,
        updatedAt: now(),
      };
      studies.set(id, updated);
      if (event) events.push({ ...event, id: nextId("evt"), studyId: id, createdAt: now() });
      return clone(updated);
    },
    async replaceParticipants(studyId, userIds) {
      const s = studies.get(studyId);
      if (s) s.participantIds = [...userIds];
    },
    async listEvents(studyId) {
      return clone(events.filter((e) => e.studyId === studyId));
    },

    async listNotes(studyId) {
      return clone([...notes.values()].filter((n) => n.studyId === studyId).reverse());
    },
    async findNote(id) {
      return clone(notes.get(id) ?? null);
    },
    async createNote(data) {
      const note: StudyNote = { ...data, id: nextId("note"), createdAt: now(), updatedAt: now() };
      notes.set(note.id, note);
      return clone(note);
    },
    async deleteNote(id) {
      notes.delete(id);
    },

    async listWatchlists(organizationId) {
      return clone([...watchlists.values()].filter((w) => w.organizationId === organizationId));
    },
    async listAllWatchlists() {
      return clone([...watchlists.values()]);
    },
    async findWatchlist(id) {
      return clone(watchlists.get(id) ?? null);
    },
    async createWatchlist(data) {
      const exists = [...watchlists.values()].some(
        (w) => w.organizationId === data.organizationId && w.name === data.name,
      );
      if (exists) return null;
      const w: Watchlist = { ...data, id: nextId("wl"), createdAt: now(), updatedAt: now(), items: [] };
      watchlists.set(w.id, w);
      return clone(w);
    },
    async deleteWatchlist(id) {
      watchlists.delete(id);
    },
    async addWatchlistItem(data) {
      const w = watchlists.get(data.watchlistId)!;
      const existing = w.items.find((i) =>
        data.type === "STUDY" ? i.studyId === data.studyId : i.startupId === data.startupId,
      );
      if (existing) return clone(existing);
      const item: WatchlistItem = { ...data, id: nextId("wli"), createdAt: now() };
      w.items.push(item);
      return clone(item);
    },
    async removeWatchlistItem(watchlistId, itemId) {
      const w = watchlists.get(watchlistId);
      if (!w) return false;
      const before = w.items.length;
      w.items = w.items.filter((i) => i.id !== itemId);
      return w.items.length < before;
    },

    async createAlerts(newAlerts: NewAlert[]) {
      const created: CreatedAlert[] = [];
      for (const a of newAlerts) {
        if (alerts.some((x) => x.organizationId === a.organizationId && x.dedupeKey === a.dedupeKey)) continue;
        alerts.push({
          id: nextId("alert"),
          organizationId: a.organizationId,
          type: a.type,
          studyId: a.studyId ?? null,
          startupId: a.startupId ?? null,
          marketId: a.marketId ?? null,
          title: a.title,
          body: a.body,
          payload: a.payload ?? {},
          dedupeKey: a.dedupeKey,
          createdAt: now(),
        });
        created.push(clone(alerts[alerts.length - 1]));
      }
      return created;
    },
    async listAlerts(organizationId, userId, options) {
      return clone(
        alerts
          .filter((a) => a.organizationId === organizationId)
          .filter((a) => !options.type || a.type === options.type)
          .map((a) => ({ ...a, readAt: receipts.get(`${a.id}:${userId}`) ?? null }))
          .filter((a) => !options.unreadOnly || !a.readAt)
          .reverse()
          .slice(0, options.limit),
      );
    },
    async countUnreadAlertsByStudy(organizationId, userId) {
      const counts = new Map<string | null, number>();
      for (const a of alerts) {
        if (a.organizationId !== organizationId || receipts.has(`${a.id}:${userId}`)) continue;
        counts.set(a.studyId, (counts.get(a.studyId) ?? 0) + 1);
      }
      return [...counts].map(([studyId, count]) => ({ studyId, count }));
    },
    async markAlertsRead(organizationId, userId, alertIds, at) {
      for (const a of alerts) {
        if (a.organizationId === organizationId && alertIds.includes(a.id)) {
          if (!receipts.has(`${a.id}:${userId}`)) receipts.set(`${a.id}:${userId}`, at);
        }
      }
    },

    async createReport(data) {
      const r: SavedReport = { ...data, id: nextId("rpt"), createdAt: now() };
      reports.set(r.id, r);
      return clone(r);
    },
    async listReports(organizationId, options) {
      return clone(
        [...reports.values()]
          .filter((r) => r.organizationId === organizationId && (!options.studyId || r.studyId === options.studyId))
          .slice(0, options.limit),
      );
    },
    async findReport(id) {
      return clone(reports.get(id) ?? null);
    },
  };
}

export interface FakePlatformState {
  sessionUser: SessionUser | null;
  memberships: Map<string, OrgMembership[]>;
  users: UserSummary[];
  startups: (StartupSummary & { isPublished?: boolean })[];
  markets: (MarketSummary & { visibility: string; studyId?: string })[];
  createdMarkets: { studyId: string; marketId: string }[];
  closedMarketStudyIds: string[];
  notifications: (PersonalNotification & { readAt: Date | null })[];
  facts: StartupFactView[];
  news: StartupNewsView[];
}

const toStartupSummary = (x: StartupSummary): StartupSummary => ({
  id: x.id,
  name: x.name,
  slug: x.slug,
  industry: x.industry,
});

export function createFakePlatform(state: Partial<FakePlatformState> = {}): PlatformGateway & {
  state: FakePlatformState;
} {
  const s: FakePlatformState = {
    sessionUser: null,
    memberships: new Map(),
    users: [],
    startups: [],
    markets: [],
    createdMarkets: [],
    closedMarketStudyIds: [],
    notifications: [],
    facts: [],
    news: [],
    ...state,
  };
  return {
    state: s,
    async getSessionUser() {
      return s.sessionUser;
    },
    async getMemberships(userId) {
      return s.memberships.get(userId) ?? [];
    },
    async getUsers(ids) {
      return s.users.filter((u) => ids.includes(u.id));
    },
    async findUsersByEmail(emails) {
      return s.users.filter((u) => u.email && emails.includes(u.email.toLowerCase()));
    },
    async getStartups(ids) {
      return s.startups.filter((x) => ids.includes(x.id) && x.isPublished !== false).map(toStartupSummary);
    },
    async searchStartups(q, limit) {
      return s.startups
        .filter((x) => x.isPublished !== false && x.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, limit)
        .map(toStartupSummary);
    },
    async listPublicMarketsForStartups(startupIds) {
      return s.markets
        .filter((m) => m.visibility === "PUBLIC" && !m.studyId && startupIds.includes(m.startupId))
        .map((m) => ({ id: m.id, startupId: m.startupId, question: m.question, status: m.status, closesAt: m.closesAt }));
    },
    async createMarketForStudy(input) {
      const existing = s.createdMarkets.find((m) => m.studyId === input.studyId);
      if (existing) return { marketId: existing.marketId };
      const marketId = `mkt_${input.studyId}`;
      s.createdMarkets.push({ studyId: input.studyId, marketId });
      return { marketId };
    },
    async getStartupEvidence(startupIds) {
      const published = new Set(s.startups.filter((x) => x.isPublished !== false).map((x) => x.id));
      const ok = (id: string) => startupIds.includes(id) && published.has(id);
      return {
        facts: s.facts.filter((f) => ok(f.startupId)),
        news: s.news.filter((n) => ok(n.startupId)),
      };
    },
    async listOrgMembers(organizationId) {
      return [...s.memberships]
        .flatMap(([userId, ms]) => ms.filter((m) => m.organizationId === organizationId).map((m) => ({ userId, role: m.role })));
    },
    async notifyUsers(notifications) {
      s.notifications.push(...notifications.map((n) => ({ ...n, readAt: null })));
      return notifications.length;
    },
    async markAlertNotificationsRead(userId, alertIds, at) {
      for (const n of s.notifications) {
        if (n.userId === userId && !n.readAt && alertIds.includes(n.data.vcAlertId)) n.readAt = at;
      }
    },
    async closeMarketForStudy(input) {
      if (s.createdMarkets.some((m) => m.studyId === input.studyId)) s.closedMarketStudyIds.push(input.studyId);
    },
  };
}

export function createFakeForecasting(
  estimates: Map<string, MarketEstimate> = new Map(),
  histories: Map<string, EstimatePoint[]> = new Map(),
): ForecastingGateway & { estimates: Map<string, MarketEstimate>; histories: Map<string, EstimatePoint[]> } {
  return {
    estimates,
    histories,
    async getEstimates(ids) {
      return new Map([...estimates].filter(([id]) => ids.includes(id)));
    },
    async getHistory(marketId, options) {
      const from = options?.from?.getTime() ?? -Infinity;
      return (histories.get(marketId) ?? []).filter((p) => p.at.getTime() >= from);
    },
  };
}

/** Indicators keyed by startup slug; anything else is "not tracked". */
export function createFakeIndicators(bySlug: Map<string, CompareIndicators> = new Map()): IndicatorGateway & {
  bySlug: Map<string, CompareIndicators>;
} {
  return {
    bySlug,
    async getIndicators(startup) {
      return bySlug.get(startup.slug) ?? { status: "not_tracked", rows: [] };
    },
  };
}

export function createTestDeps(now: Date = new Date("2026-10-01T12:00:00Z")) {
  let current = now;
  const clock = () => current;
  const repo = createMemoryRepository(clock);
  const platform = createFakePlatform();
  const forecasting = createFakeForecasting();
  const indicators = createFakeIndicators();
  const deps: VcDeps = { repo, platform, forecasting, indicators, now: clock };
  return {
    deps,
    repo,
    platform,
    forecasting,
    indicators,
    setNow: (d: Date) => {
      current = d;
    },
  };
}

export function makeEstimate(marketId: string, overrides: Partial<MarketEstimate> = {}): MarketEstimate {
  return {
    marketId,
    status: "OPEN",
    openingBaseline: { value: 0.3, methodology: "Base rate" },
    allocation: { yesCredits: 600, noCredits: 400, totalCredits: 1000, yesShare: 0.6 },
    calibratedProbability: null,
    participantCount: 12,
    forecastCount: 20,
    lastForecastAt: new Date("2026-10-01T10:00:00Z"),
    asOf: new Date("2026-10-01T11:55:00Z"),
    resolution: null,
    ...overrides,
  };
}
