import { VcError, forbidden, notFound } from "../errors";
import { TRANSITIONS, checkDeadline, getTransitionIssues, timestampPatchFor, type StudyAction } from "../lifecycle";
import {
  canProposeInActiveOrg,
  getStudyPermissions,
  redactStudy,
  type StudyPermissions,
  type StudyView,
} from "../permissions";
import type { NewAlert, StudyPatch, VcDeps } from "../ports";
import {
  PUBLISHED_STATUSES,
  type EstimatePoint,
  type MarketEstimate,
  type Study,
  type StudyEvent,
  type StudyNote,
  type StudyStatus,
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
}

export interface StudyListItem {
  study: StudyView;
  permissions: StudyPermissions;
  estimate: MarketEstimate | null;
}

const PENDING_STATUSES: readonly StudyStatus[] = ["SUBMITTED", "APPROVED"];

export function createStudyService(deps: VcDeps) {
  const { repo, platform, forecasting, now } = deps;

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

    const [startups, estimates, history, events, participants] = await Promise.all([
      platform.getStartups([study.startupId]),
      estimatesFor([study]),
      study.marketId ? forecasting.getHistory(study.marketId) : Promise.resolve([]),
      repo.listEvents(study.id),
      full && study.participantIds.length > 0
        ? platform.getUsers(study.participantIds)
        : Promise.resolve(full ? [] : null),
    ]);
    const startup = startups[0];

    return {
      study: redactStudy(ctx, study, permissions),
      permissions,
      startup: startup ? { id: startup.id, name: startup.name, slug: startup.slug } : null,
      estimate: study.marketId ? estimates.get(study.marketId) ?? null : null,
      history,
      // Limited viewers see when the status changed, not who changed it or why.
      events: full ? events : events.map((e) => ({ ...e, actorId: null, reason: null })),
      participants: participants as UserSummary[] | null,
    };
  }

  async function assertStartupExists(startupId: string) {
    const [startup] = await platform.getStartups([startupId]);
    if (!startup) throw new VcError("VALIDATION", "Unknown startup", [{ path: "startupId", message: "Startup not found" }]);
  }

  async function create(ctx: VcContext, input: CreateStudyInput): Promise<StudyView> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    if (!canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot propose studies");
    await assertStartupExists(input.startupId);
    const deadlineIssue = checkDeadline(input.deadline, now());
    if (deadlineIssue) throw new VcError("VALIDATION", deadlineIssue, [{ path: "deadline", message: deadlineIssue }]);

    const study = await repo.createStudy({
      organizationId: ctx.activeOrg.organizationId,
      createdById: ctx.user.id,
      startupId: input.startupId,
      question: input.question,
      yesCriteria: input.yesCriteria,
      noCriteria: input.noCriteria,
      context: input.context ?? null,
      baselineValue: input.baselineValue ?? null,
      baselineMethodology: input.baselineMethodology ?? null,
      deadline: input.deadline,
      visibility: input.visibility,
      sources: (input.sources ?? []).map((s) => ({
        url: s.url,
        title: s.title,
        publisher: s.publisher ?? null,
        publishedAt: s.publishedAt ?? null,
      })),
    });
    return redactStudy(ctx, study, getStudyPermissions(ctx, study));
  }

  async function update(ctx: VcContext, studyId: string, input: UpdateStudyInput): Promise<StudyView> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    if (!permissions.canEdit) {
      throw study.status === "DRAFT" ? forbidden() : new VcError("CONFLICT", "Only draft studies can be edited");
    }
    const { expectedVersion, sources, ...fields } = input;
    if (fields.startupId && fields.startupId !== study.startupId) await assertStartupExists(fields.startupId);
    if (fields.deadline) {
      const issue = checkDeadline(fields.deadline, now());
      if (issue) throw new VcError("VALIDATION", issue, [{ path: "deadline", message: issue }]);
    }
    const nextBaseline = fields.baselineValue !== undefined ? fields.baselineValue : study.baselineValue;
    const nextMethod =
      fields.baselineMethodology !== undefined ? fields.baselineMethodology : study.baselineMethodology;
    if ((nextBaseline == null) !== (nextMethod == null)) {
      throw new VcError("VALIDATION", "Provide the baseline value and its methodology together", [
        { path: "baselineMethodology", message: "Required together with the baseline value" },
      ]);
    }

    const patch: StudyPatch = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    if (sources) {
      patch.sources = sources.map((s) => ({
        url: s.url,
        title: s.title,
        publisher: s.publisher ?? null,
        publishedAt: s.publishedAt ?? null,
      }));
    }

    const updated = await repo.updateStudy(studyId, expectedVersion, patch);
    if (!updated) throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
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

    const updated = await repo.updateStudy(study.id, study.version, patch, {
      actorId,
      action,
      fromStatus: study.status,
      toStatus: rule.to,
      reason,
    });
    if (!updated) throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    await repo.createAlerts([statusAlert(updated, rule.to, updated.version)]);
    return updated;
  }

  async function transition(ctx: VcContext, studyId: string, input: TransitionInput): Promise<StudyView> {
    const { study, permissions } = await loadVisible(ctx, studyId);
    const rule = TRANSITIONS[input.action];

    if (!rule.from.includes(study.status)) {
      throw new VcError("INVALID_TRANSITION", `Cannot ${input.action} a study that is ${study.status.toLowerCase()}`);
    }
    if (!permissions.allowedActions.includes(input.action)) throw forbidden();
    if (study.version !== input.expectedVersion) {
      throw new VcError("CONFLICT", "This study was changed by someone else. Reload and try again.");
    }
    if (rule.requiresReason && !input.reason) {
      throw new VcError("VALIDATION", "A reason is required", [{ path: "reason", message: "Required" }]);
    }
    const issues = getTransitionIssues(input.action, study, now());
    if (issues.length > 0) {
      throw new VcError("VALIDATION", issues[0], issues.map((message) => ({ path: "", message })));
    }

    let extra: StudyPatch = {};
    if (input.action === "open") {
      // Idempotent on retry: the market service keys on studyId.
      const { marketId } = study.marketId
        ? { marketId: study.marketId }
        : await platform.createMarketForStudy({
            studyId: study.id,
            organizationId: study.organizationId,
            startupId: study.startupId,
            question: study.question,
            yesCriteria: study.yesCriteria,
            noCriteria: study.noCriteria,
            closesAt: study.deadline,
            openingBaseline: { value: study.baselineValue!, methodology: study.baselineMethodology! },
            visibility: study.visibility,
            sources: study.sources.map((s) => ({ url: s.url, title: s.title })),
            createdById: ctx.user.id,
          });
      extra = { marketId };
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
      throw new VcError("VALIDATION", "Some emails do not belong to VentureCast users", { unknownEmails });
    }
    const byId = input.userIds.length > 0 ? await platform.getUsers(input.userIds) : [];
    if (byId.length !== new Set(input.userIds).size) {
      throw new VcError("VALIDATION", "Some participants could not be found");
    }

    const userIds = [...new Set([...byId.map((u) => u.id), ...byEmail.map((u) => u.id)])];
    if (study.visibility === "RESTRICTED" && PUBLISHED_STATUSES.includes(study.status) && userIds.length === 0) {
      throw new VcError("VALIDATION", "An open restricted study must keep at least one participant");
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
   * mirrors market resolutions. Safe to run repeatedly.
   */
  async function syncWithMarkets(): Promise<{ closed: number; resolved: number }> {
    const studies = await repo.listStudies({ statuses: ["OPEN", "CLOSED"], hasMarket: true });
    const estimates = await estimatesFor(studies);
    const at = now();
    let closed = 0;
    let resolved = 0;

    for (const study of studies) {
      const estimate = study.marketId ? estimates.get(study.marketId) : undefined;
      try {
        if (estimate?.resolution) {
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
        // A concurrent update already moved the study on; the next run will reconcile.
        if (!(err instanceof VcError && err.code === "CONFLICT")) throw err;
      }
    }
    return { closed, resolved };
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
    loadVisible,
  };
}

export type StudyService = ReturnType<typeof createStudyService>;
