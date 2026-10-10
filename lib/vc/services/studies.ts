import { MAX_SOURCES } from "../constants";
import { VcError, forbidden, notFound } from "../errors";
import { TRANSITIONS, checkDeadline, getTransitionIssues, timestampPatchFor, type StudyAction } from "../lifecycle";
import {
  canProposeInActiveOrg,
  getStudyPermissions,
  redactStudy,
  type StudyPermissions,
  type StudyView,
} from "../permissions";
import { marketModelInput } from "../opening-line";
import type { NewAlert, StudyPatch, VcDeps } from "../ports";
import { createAlertPublisher } from "./alert-publisher";
import { createOpeningLineService, toEstimateView, type EstimateView } from "./opening-line";
import {
  PUBLISHED_STATUSES,
  type EstimatePoint,
  type FirmObservation,
  type MarketEstimate,
  type MetricLink,
  type ModelEstimate,
  type StartupFactView,
  type StartupNewsView,
  type Study,
  type StudyEvent,
  type StudyNote,
  type StudyStatus,
  type StudyVisibility,
  type UserSummary,
  type VcContext,
} from "../types";
import type {
  CreateStudyInput,
  ParticipantsInput,
  TransitionInput,
  UpdateStudyInput,
} from "../validation";

export interface StudyDetail {
  study: StudyView;
  permissions: StudyPermissions;
  startup: { id: string; name: string; slug: string } | null;
  estimate: MarketEstimate | null;
  history: EstimatePoint[];
  /** Full timeline for the firm; status-only timeline for limited viewers. */
  events: StudyEvent[];
  participants: UserSummary[] | null;
  /** Public facts and news about the study's startup, newest first. */
  evidence: { facts: StartupFactView[]; news: StartupNewsView[] };
  /** The model's opening line. Null for studies created before the model set them. */
  openingLine: (EstimateView & { metricLabel: string | null }) | null;
  /** The firm's own figures behind the opening line; only for the owning firm's editors. */
  firmObservations: FirmObservation[] | null;
}

/** Most facts and news items shown on a study page. */
export const STUDY_EVIDENCE_LIMITS = { facts: 20, news: 10 } as const;

export interface StudyListItem {
  study: StudyView;
  permissions: StudyPermissions;
  estimate: MarketEstimate | null;
}

/**
 * How long after resolution a study keeps checking for outcome corrections.
 * Outcomes can only change until credits are settled, which normally happens
 * within minutes; the window leaves room for failed settlements being retried.
 */
const CORRECTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const PENDING_STATUSES: readonly StudyStatus[] = ["SUBMITTED", "APPROVED"];

export function createStudyService(deps: VcDeps) {
  const { repo, platform, forecasting, now } = deps;
  const alertPublisher = createAlertPublisher(deps);
  const openingLine = createOpeningLineService(deps);

  /** Loads a study and enforces view access; hides existence from unauthorized callers. */
  async function loadVisible(ctx: VcContext, studyId: string) {
    const study = await repo.findStudy(studyId);
    if (!study) throw notFound("Study");
    const permissions = getStudyPermissions(ctx, study);
    if (!permissions.canView) throw notFound("Study");
    return { study, permissions };
  }

  async function estimatesFor(studies: Study[]): Promise<Map<string, MarketEstimate>> {
    const marketIds = studies.map((s) => s.marketId).filter((id): id is string => !!id);
    if (marketIds.length === 0) return new Map();
    return forecasting.getEstimates(marketIds);
  }

  async function list(
    ctx: VcContext,
    query: { scope: "organization" | "public" | "participating"; status?: StudyStatus },
  ): Promise<StudyListItem[]> {
    const statuses = query.status ? [query.status] : undefined;
    let studies: Study[];
    switch (query.scope) {
      case "organization":
        if (!ctx.activeOrg) return [];
        studies = await repo.listStudies({ organizationId: ctx.activeOrg.organizationId, statuses });
        break;
      case "public":
        studies = await repo.listStudies({
          visibility: "PUBLIC",
          statuses: statuses ?? PUBLISHED_STATUSES,
          limit: 200,
        });
        break;
      case "participating":
        studies = await repo.listStudies({ participantUserId: ctx.user.id, statuses });
        break;
    }

    // Defense in depth: every row is re-checked against the permission model.
    const visible = studies
      .map((study) => ({ study, permissions: getStudyPermissions(ctx, study) }))
      .filter((r) => r.permissions.canView);
    const estimates = await estimatesFor(visible.map((r) => r.study));
    return visible.map(({ study, permissions }) => ({
      study: redactStudy(ctx, study, permissions),
      permissions,
      estimate: study.marketId ? estimates.get(study.marketId) ?? null : null,
    }));
  }

  /** Studies awaiting platform review. Platform admins only. */
  async function listReviewQueue(ctx: VcContext): Promise<StudyListItem[]> {
    if (!ctx.user.isPlatformAdmin) throw forbidden();
    const studies = await repo.listStudies({ statuses: PENDING_STATUSES });
    return studies.map((study) => {
      const permissions = getStudyPermissions(ctx, study);
      return { study: redactStudy(ctx, study, permissions), permissions, estimate: null };
    });
  }

  async function get(ctx: VcContext, studyId: string): Promise<StudyDetail> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    const full = permissions.viewLevel === "full";

    const [startups, estimates, history, events, participants, evidence, modelEstimate] = await Promise.all([
      platform.getStartups([study.startupId]),
      estimatesFor([study]),
      study.marketId ? forecasting.getHistory(study.marketId) : Promise.resolve([]),
      repo.listEvents(study.id),
      full && study.participantIds.length > 0
        ? platform.getUsers(study.participantIds)
        : Promise.resolve(full ? [] : null),
      platform.getStartupEvidence([study.startupId]),
      repo.findModelEstimate(study.id),
    ]);
    const startup = startups[0];
    const metricLabel =
      modelEstimate?.link && startup
        ? (openingLine.metricsFor(startup).find((m) => m.id === modelEstimate.link!.metricId)?.label ?? null)
        : null;

    return {
      study: redactStudy(ctx, study, permissions),
      permissions,
      startup: startup ? { id: startup.id, name: startup.name, slug: startup.slug } : null,
      estimate: study.marketId ? estimates.get(study.marketId) ?? null : null,
      history,
      // Limited viewers see when the status changed, not who changed it or why.
      events: full ? events : events.map((e) => ({ ...e, actorId: null, reason: null })),
      participants: participants as UserSummary[] | null,
      evidence: {
        facts: evidence.facts.slice(0, STUDY_EVIDENCE_LIMITS.facts),
        news: evidence.news.slice(0, STUDY_EVIDENCE_LIMITS.news),
      },
      openingLine: modelEstimate ? { ...toEstimateView(modelEstimate), metricLabel } : null,
      firmObservations: modelEstimate && permissions.canViewPrivate ? modelEstimate.observations : null,
    };
  }

  /** The question, criteria and baseline fields that follow from an estimate. */
  function fieldsFrom(estimate: ModelEstimate, typed: { question: string; yesCriteria: string; noCriteria: string }) {
    const linked = estimate.status !== "NOT_MEASURABLE" && !!estimate.question;
    return {
      // A linked question is worded exactly as the model priced it, so it resolves the same way.
      question: linked ? estimate.question! : typed.question,
      yesCriteria: linked ? estimate.yesCriteria! : typed.yesCriteria,
      noCriteria: linked ? estimate.noCriteria! : typed.noCriteria,
      baselineValue: estimate.status === "OK" ? estimate.probability : null,
      baselineMethodology: estimate.status === "OK" ? estimate.methodology : null,
    };
  }

  /**
   * The study's visibility follows who may trade: a question open to the public
   * is public research; one for verified users only stays with the firm (its
   * market's audience is set when forecasting opens).
   */
  function visibilityFor(audience: { openToPublic: boolean; openToVerified: boolean }): StudyVisibility {
    return audience.openToPublic ? "PUBLIC" : "ORGANIZATION";
  }

  /**
   * Who the market is for. Verified-users-only questions open as public markets
   * that only verified users of the product can trade or see the line of
   * (lib/product-verification.ts); everything else keeps the study's visibility.
   * Verified users' trades on a public market make up its verified line.
   */
  function marketAudience(study: Study): { visibility: StudyVisibility; verifiedUsersOnly: boolean } {
    const verifiedOnly = study.openToVerified && !study.openToPublic;
    return verifiedOnly ? { visibility: "PUBLIC", verifiedUsersOnly: true } : { visibility: study.visibility, verifiedUsersOnly: false };
  }

  function audienceOf(input: { openToPublic?: boolean; openToVerified?: boolean }) {
    const audience = { openToPublic: input.openToPublic ?? true, openToVerified: input.openToVerified ?? false };
    if (!audience.openToPublic && !audience.openToVerified) {
      throw new VcError("VALIDATION_ERROR", "Open the question to the public, to verified users, or both", [
        { path: "openToPublic", message: "Choose at least one" },
      ]);
    }
    return audience;
  }

  /** A linked question resolves from a public source; make sure the study names it first. */
  function withResolutionSource<T extends { url: string; title: string; publisher: string | null; publishedAt: Date | null }>(
    sources: T[],
    estimate: ModelEstimate,
  ): (T | { url: string; title: string; publisher: string | null; publishedAt: Date | null })[] {
    const source = estimate.status === "NOT_MEASURABLE" ? null : estimate.resolutionSource;
    if (!source || sources.some((s) => s.url === source.url)) return sources;
    return [{ url: source.url, title: source.title, publisher: "Public data source", publishedAt: null }, ...sources].slice(0, MAX_SOURCES);
  }

  const linkOf = (input: { metricId: string; threshold: number; targetDate: string }): MetricLink => ({
    metricId: input.metricId,
    threshold: input.threshold,
    targetDate: input.targetDate,
  });

  async function startupOrThrow(startupId: string) {
    const [startup] = await platform.getStartups([startupId]);
    if (!startup) throw new VcError("VALIDATION_ERROR", "Unknown startup", [{ path: "startupId", message: "Startup not found" }]);
    return startup;
  }

  async function create(ctx: VcContext, input: CreateStudyInput): Promise<StudyView> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    if (!canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot propose studies");
    const startup = await startupOrThrow(input.startupId);
    const deadlineIssue = checkDeadline(input.deadline, now());
    if (deadlineIssue) throw new VcError("VALIDATION_ERROR", deadlineIssue, [{ path: "deadline", message: deadlineIssue }]);

    const { estimate, figures } = await openingLine.estimateFor(ctx.activeOrg.organizationId, startup, linkOf(input.modelLink), input.deadline);

    const study = await repo.createStudy({
      organizationId: ctx.activeOrg.organizationId,
      createdById: ctx.user.id,
      startupId: input.startupId,
      ...fieldsFrom(estimate, { question: input.question ?? "", yesCriteria: input.yesCriteria ?? "", noCriteria: input.noCriteria ?? "" }),
      context: input.context ?? null,
      deadline: input.deadline,
      visibility: input.visibility ?? visibilityFor(audienceOf(input)),
      ...audienceOf(input),
      prizePoolCredits: input.prizePoolCredits ?? 0,
      sources: withResolutionSource(
        (input.sources ?? []).map((s) => ({
          url: s.url,
          title: s.title,
          publisher: s.publisher ?? null,
          publishedAt: s.publishedAt ?? null,
        })),
        estimate,
      ),
    });
    await openingLine.save(study, estimate, figures, ctx.user.id);
    return redactStudy(ctx, study, getStudyPermissions(ctx, study));
  }

  async function update(ctx: VcContext, studyId: string, input: UpdateStudyInput): Promise<StudyView> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    if (!permissions.canEdit) {
      throw study.status === "DRAFT" ? forbidden() : new VcError("CONFLICT", "Only draft studies can be edited");
    }
    const { expectedVersion, sources, modelLink, ...fields } = input;
    const startupId = fields.startupId ?? study.startupId;
    const startup = await startupOrThrow(startupId);
    if (fields.deadline) {
      const issue = checkDeadline(fields.deadline, now());
      if (issue) throw new VcError("VALIDATION_ERROR", issue, [{ path: "deadline", message: issue }]);
    }

    const patch: StudyPatch = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    const audience = {
      openToPublic: fields.openToPublic ?? study.openToPublic,
      openToVerified: fields.openToVerified ?? study.openToVerified,
    };
    if (!audience.openToPublic && !audience.openToVerified) {
      throw new VcError("VALIDATION_ERROR", "Open the question to the public, to verified users, or both", [
        { path: "openToPublic", message: "Choose at least one" },
      ]);
    }
    // Changing who can trade moves the study's visibility with it, unless a visibility was set explicitly.
    if (fields.visibility === undefined && (fields.openToPublic !== undefined || fields.openToVerified !== undefined)) {
      patch.visibility = visibilityFor(audience);
    }

    // Re-price whenever anything the estimate depends on changes. Undefined modelLink keeps the stored link.
    const stored = await repo.findModelEstimate(study.id);
    const link = modelLink === undefined ? (stored?.link ?? null) : linkOf(modelLink);
    const repriced =
      modelLink !== undefined || !stored || startupId !== study.startupId || (!!fields.deadline && !!link);
    const { estimate, figures } = repriced
      ? await openingLine.estimateFor(study.organizationId, startup, link, fields.deadline ?? study.deadline)
      : { estimate: stored!, figures: stored!.observations };
    if (repriced) {
      Object.assign(
        patch,
        fieldsFrom(estimate, {
          question: fields.question ?? study.question,
          yesCriteria: fields.yesCriteria ?? study.yesCriteria,
          noCriteria: fields.noCriteria ?? study.noCriteria,
        }),
      );
    } else if (stored?.link) {
      // Still linked: the wording stays exactly what the model priced.
      patch.question = study.question;
      patch.yesCriteria = study.yesCriteria;
      patch.noCriteria = study.noCriteria;
    }
    if (sources || repriced) {
      const next = sources
        ? sources.map((s) => ({ url: s.url, title: s.title, publisher: s.publisher ?? null, publishedAt: s.publishedAt ?? null }))
        : study.sources.map(({ url, title, publisher, publishedAt }) => ({ url, title, publisher, publishedAt }));
      patch.sources = withResolutionSource(next, estimate);
    }

    const updated = await repo.updateStudy(studyId, expectedVersion, patch);
    if (!updated) throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    if (repriced) await openingLine.save(updated, estimate, figures, ctx.user.id);
    return redactStudy(ctx, updated, getStudyPermissions(ctx, updated));
  }

  function statusAlert(study: Study, toStatus: StudyStatus, version: number): NewAlert {
    return {
      organizationId: study.organizationId,
      type: toStatus === "RESOLVED" ? "STUDY_RESOLVED" : "STUDY_STATUS_CHANGED",
      studyId: study.id,
      startupId: study.startupId,
      marketId: study.marketId,
      title:
        toStatus === "RESOLVED"
          ? `Study resolved: ${study.resolvedOutcome ?? "outcome recorded"}`
          : `Study ${toStatus.toLowerCase()}`,
      body: study.question,
      payload: { status: toStatus },
      dedupeKey: `status:${study.id}:${toStatus}:${version}`,
    };
  }

  /** Applies a validated transition with compare-and-set and an audit event. */
  async function applyTransition(
    study: Study,
    action: StudyAction,
    actorId: string | null,
    reason: string | null,
    extra: StudyPatch = {},
  ): Promise<Study> {
    const rule = TRANSITIONS[action];
    const at = now();
    const patch: StudyPatch = { ...timestampPatchFor(rule.to, at), ...extra, status: rule.to };
    if (action === "reject") patch.rejectionReason = reason;
    if (action === "cancel") patch.cancellationReason = reason;
    // Stop forecasting before the study is marked closed. If the study update
    // below then loses a race, the market is already closed and the next sync
    // reconciles the study; the other order could leave a closed study with a
    // market still taking forecasts. Idempotent, and a no-op without a market.
    if (action === "close") {
      await platform.closeMarketForStudy({ studyId: study.id, closedById: actorId, reason });
    }

    const updated = await repo.updateStudy(study.id, study.version, patch, {
      actorId,
      action,
      fromStatus: study.status,
      toStatus: rule.to,
      reason,
    });
    if (!updated) throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    await alertPublisher.publish([statusAlert(updated, rule.to, updated.version)]);
    return updated;
  }

  async function transition(ctx: VcContext, studyId: string, input: TransitionInput): Promise<StudyView> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    const rule = TRANSITIONS[input.action];

    if (!rule.from.includes(study.status)) {
      throw new VcError("INVALID_STATE", `Cannot ${input.action} a study that is ${study.status.toLowerCase()}`);
    }
    if (!permissions.allowedActions.includes(input.action)) throw forbidden();
    if (study.version !== input.expectedVersion) {
      throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    }
    if (rule.requiresReason && !input.reason) {
      throw new VcError("VALIDATION_ERROR", "A reason is required", [{ path: "reason", message: "Required" }]);
    }
    const issues = getTransitionIssues(input.action, study, now());
    if (issues.length > 0) {
      throw new VcError("VALIDATION_ERROR", issues[0], issues.map((message) => ({ path: "", message })));
    }

    let extra: StudyPatch = {};
    if (input.action === "open" && study.marketId) {
      // Retry after a market was created but the study update failed: the market service keys on studyId.
      extra = { marketId: study.marketId };
    } else if (input.action === "open") {
      // The model sets the opening price, from data current at the moment forecasting opens.
      const stored = await repo.findModelEstimate(study.id);
      const startup = await startupOrThrow(study.startupId);
      const { estimate, figures } = await openingLine.estimateFor(study.organizationId, startup, stored?.link ?? null, study.deadline);
      await openingLine.save(study, estimate, figures, ctx.user.id);
      if (estimate.status !== "OK" || estimate.probability == null || !estimate.methodology) {
        const why = estimate.notes.at(-1) ?? "";
        throw new VcError(
          "VALIDATION_ERROR",
          estimate.status === "NOT_MEASURABLE"
            ? "Not enough data: this question isn't linked to a metric the model can measure, so forecasting can't open."
            : `Not enough data for the model to set an opening line, so forecasting can't open yet. ${why}`.trim(),
          [{ path: "openingLine", message: "Not enough data" }],
        );
      }
      const metricLabel = openingLine.metricsFor(startup).find((m) => m.id === estimate.link?.metricId)?.label ?? "model";
      const { marketId } = await platform.createMarketForStudy({
        studyId: study.id,
        organizationId: study.organizationId,
        startupId: study.startupId,
        question: study.question,
        yesCriteria: study.yesCriteria,
        noCriteria: study.noCriteria,
        closesAt: study.deadline,
        openingBaseline: { value: estimate.probability, methodology: estimate.methodology },
        model: marketModelInput(estimate, metricLabel),
        ...marketAudience(study),
        sources: study.sources.map((s) => ({ url: s.url, title: s.title })),
        createdById: ctx.user.id,
      });
      extra = { marketId, baselineValue: estimate.probability, baselineMethodology: estimate.methodology };
    }

    const updated = await applyTransition(study, input.action, ctx.user.id, input.reason ?? null, extra);
    return redactStudy(ctx, updated, getStudyPermissions(ctx, updated));
  }

  async function setParticipants(ctx: VcContext, studyId: string, input: ParticipantsInput) {
    const { study, permissions } = await loadVisible(ctx, studyId);
    if (!permissions.canManageParticipants) throw forbidden();

    const byEmail = input.emails.length > 0 ? await platform.findUsersByEmail(input.emails) : [];
    const foundEmails = new Set(byEmail.map((u) => u.email?.toLowerCase()));
    const unknownEmails = input.emails.filter((e) => !foundEmails.has(e));
    if (unknownEmails.length > 0) {
      throw new VcError("VALIDATION_ERROR", "Some emails do not belong to Senzi users", { unknownEmails });
    }
    const byId = input.userIds.length > 0 ? await platform.getUsers(input.userIds) : [];
    if (byId.length !== new Set(input.userIds).size) {
      throw new VcError("VALIDATION_ERROR", "Some participants could not be found");
    }

    const userIds = [...new Set([...byId.map((u) => u.id), ...byEmail.map((u) => u.id)])];
    if (study.visibility === "RESTRICTED" && PUBLISHED_STATUSES.includes(study.status) && userIds.length === 0) {
      throw new VcError("VALIDATION_ERROR", "An open restricted study must keep at least one participant");
    }
    await repo.replaceParticipants(study.id, userIds, ctx.user.id);
    return platform.getUsers(userIds);
  }

  async function listNotes(ctx: VcContext, studyId: string): Promise<StudyNote[]> {
    const { permissions } = await loadVisible(ctx, studyId);
    if (!permissions.canViewPrivate) throw notFound("Study");
    return repo.listNotes(studyId);
  }

  async function addNote(ctx: VcContext, studyId: string, body: string): Promise<StudyNote> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    if (!permissions.canWriteNotes) throw forbidden();
    return repo.createNote({ studyId, organizationId: study.organizationId, authorId: ctx.user.id, body });
  }

  async function deleteNote(ctx: VcContext, studyId: string, noteId: string): Promise<void> {
    const { permissions } = await loadVisible(ctx, studyId);
    const note = await repo.findNote(noteId);
    if (!note || note.studyId !== studyId || !permissions.canViewPrivate) throw notFound("Note");
    const isManager = ctx.memberships.some(
      (m) => m.organizationId === note.organizationId && (m.role === "OWNER" || m.role === "ADMIN"),
    );
    if (note.authorId !== ctx.user.id && !isManager) throw forbidden();
    await repo.deleteNote(noteId);
  }

  /**
   * System sync with market state: closes studies past their deadline and
   * mirrors market resolutions. Safe to run repeatedly. A failure on one study
   * is logged and skipped so the rest (and the alert run after it) still happen.
   */
  async function syncWithMarkets(): Promise<{ closed: number; resolved: number; corrected: number; failed: number }> {
    const at = now();
    const [active, recentlyResolved] = await Promise.all([
      repo.listStudies({ statuses: ["OPEN", "CLOSED"], hasMarket: true }),
      repo.listStudies({
        statuses: ["RESOLVED"],
        hasMarket: true,
        resolvedSince: new Date(at.getTime() - CORRECTION_WINDOW_MS),
      }),
    ]);
    const studies = [...active, ...recentlyResolved];
    const estimates = await estimatesFor(studies);
    let closed = 0;
    let resolved = 0;
    let corrected = 0;
    let failed = 0;

    for (const study of studies) {
      const estimate = study.marketId ? estimates.get(study.marketId) : undefined;
      try {
        if (study.status === "RESOLVED") {
          // An admin corrected the market's outcome after the study mirrored it.
          if (estimate?.resolution && estimate.resolution.outcome !== study.resolvedOutcome) {
            await applyOutcomeCorrection(study, estimate.resolution.outcome);
            corrected++;
          }
        } else if (estimate?.resolution) {
          await applyTransition(study, "resolve", null, estimate.resolution.evidenceSummary, {
            resolvedOutcome: estimate.resolution.outcome,
            resolvedAt: estimate.resolution.resolvedAt,
          });
          resolved++;
        } else if (
          study.status === "OPEN" &&
          (study.deadline.getTime() <= at.getTime() || estimate?.status === "CLOSED")
        ) {
          await applyTransition(study, "close", null, "Forecast deadline reached");
          closed++;
        }
      } catch (err) {
        // CONFLICT means a concurrent update already moved the study on; the next run reconciles it.
        if (!(err instanceof VcError && err.code === "CONFLICT")) {
          failed++;
          console.error(`[vc] sync failed for study ${study.id}`, err);
        }
      }
    }
    return { closed, resolved, corrected, failed };
  }

  /**
   * Pays prize pools for resolved studies whose markets have finished settling.
   * Safe to run repeatedly: each trader's share has its own idempotency key,
   * and a paid study is marked so it's skipped next time.
   */
  async function payPrizePools(): Promise<{ paid: number; pending: number; failed: number }> {
    const due = (await repo.listStudies({ statuses: ["RESOLVED"], hasMarket: true })).filter(
      (s) => s.prizePoolCredits > 0 && !s.prizeDistributedAt,
    );
    let paid = 0;
    let pending = 0;
    let failed = 0;
    for (const study of due) {
      try {
        const result = await platform.payPrizePool({
          studyId: study.id,
          marketId: study.marketId!,
          credits: study.prizePoolCredits,
          question: study.question,
        });
        if (result.state === "pending") {
          pending++;
          continue;
        }
        const updated = await repo.updateStudy(study.id, study.version, { prizeDistributedAt: now() });
        if (!updated) continue; // changed concurrently; the next run marks it (payouts are idempotent)
        await alertPublisher.publish([
          {
            organizationId: study.organizationId,
            type: "STUDY_STATUS_CHANGED",
            studyId: study.id,
            startupId: study.startupId,
            marketId: study.marketId,
            title: result.winners > 0 ? "Prize pool paid" : "Prize pool not paid",
            body:
              result.winners > 0
                ? `${result.paid.toLocaleString("en-US")} credits went to ${result.winners} trader${result.winners === 1 ? "" : "s"} who gained on "${study.question}".`
                : `No trader gained credits on "${study.question}", so its prize pool wasn't paid out.`,
            dedupeKey: `prize-paid:${study.id}`,
          },
        ]);
        paid++;
      } catch (err) {
        failed++;
        console.error(`[vc] prize pool payout failed for study ${study.id}`, err);
      }
    }
    return { paid, pending, failed };
  }

  /**
   * Mirrors a corrected market outcome onto an already-resolved study. Status
   * stays RESOLVED; the change is recorded as a study event and announced to
   * the firm. Evidence-only corrections need nothing here: evidence is read
   * live from the market.
   */
  async function applyOutcomeCorrection(study: Study, outcome: NonNullable<Study["resolvedOutcome"]>) {
    const from = study.resolvedOutcome;
    const updated = await repo.updateStudy(study.id, study.version, { resolvedOutcome: outcome }, {
      actorId: null,
      action: "correct_resolution",
      fromStatus: "RESOLVED",
      toStatus: "RESOLVED",
      reason: `Outcome corrected from ${from ?? "none"} to ${outcome}`,
    });
    if (!updated) throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    await alertPublisher.publish([
      {
        organizationId: study.organizationId,
        type: "STUDY_RESOLVED",
        studyId: study.id,
        startupId: study.startupId,
        marketId: study.marketId,
        title: `Study outcome corrected: ${from ?? "none"} → ${outcome}`,
        body: study.question,
        payload: { from, to: outcome },
        dedupeKey: `resolution-corrected:${study.id}:${updated.version}`,
      },
    ]);
    return updated;
  }

  return {
    list,
    listReviewQueue,
    get,
    create,
    update,
    transition,
    setParticipants,
    listNotes,
    addNote,
    deleteNote,
    syncWithMarkets,
    payPrizePools,
    loadVisible,
  };
}

export type StudyService = ReturnType<typeof createStudyService>;
