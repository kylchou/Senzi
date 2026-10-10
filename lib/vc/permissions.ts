/**
 * Server-side access rules for VC studies. Every service call and page goes
 * through these functions; UI hints are derived from the same result.
 *
 * View levels:
 *  - "full":    the owning firm's members with access (notes, reports, participant list).
 *  - "limited": question, criteria, context, sources, baseline and estimates only.
 *               Granted to external invited participants, platform reviewers, and
 *               anyone for published PUBLIC studies.
 *  - "none":    the study is reported as not found.
 */
import { TRANSITIONS, type LifecycleActor, type StudyAction, isEditable } from "./lifecycle";
import {
  PUBLISHED_STATUSES,
  TERMINAL_STATUSES,
  type OrgMembership,
  type OrgRole,
  type Study,
  type VcContext,
} from "./types";

export type ViewLevel = "full" | "limited" | "none";

export interface StudyPermissions {
  viewLevel: ViewLevel;
  canView: boolean;
  /** Notes, saved reports, participant list, full timeline. */
  canViewPrivate: boolean;
  canEdit: boolean;
  canManageParticipants: boolean;
  canWriteNotes: boolean;
  canGenerateReports: boolean;
  /** Client-callable actions this user may perform right now. */
  allowedActions: StudyAction[];
}

const MANAGER_ROLES: readonly OrgRole[] = ["OWNER", "ADMIN"];
const PROPOSER_ROLES: readonly OrgRole[] = ["OWNER", "ADMIN", "ANALYST"];

export const isManagerRole = (role: OrgRole) => MANAGER_ROLES.includes(role);
export const isProposerRole = (role: OrgRole) => PROPOSER_ROLES.includes(role);

export function membershipFor(ctx: VcContext, organizationId: string): OrgMembership | null {
  return ctx.memberships.find((m) => m.organizationId === organizationId) ?? null;
}

const NO_ACCESS: StudyPermissions = {
  viewLevel: "none",
  canView: false,
  canViewPrivate: false,
  canEdit: false,
  canManageParticipants: false,
  canWriteNotes: false,
  canGenerateReports: false,
  allowedActions: [],
};

export function getStudyPermissions(ctx: VcContext, study: Study): StudyPermissions {
  const membership = membershipFor(ctx, study.organizationId);
  const userId = ctx.user.id;
  const isParticipant = study.participantIds.includes(userId);
  const isPublished = PUBLISHED_STATUSES.includes(study.status);

  const isManager = !!membership && isManagerRole(membership.role);
  const isAuthor = !!membership && isProposerRole(membership.role) && study.createdById === userId;

  // Firm members see everything for non-restricted studies; restricted studies are
  // limited to managers, the author, and firm members who were invited.
  const hasFullAccess =
    !!membership &&
    (study.visibility !== "RESTRICTED" || isManager || isAuthor || isParticipant);

  let viewLevel: ViewLevel = "none";
  if (hasFullAccess) {
    viewLevel = "full";
  } else if (ctx.user.isPlatformAdmin && study.status !== "DRAFT") {
    viewLevel = "limited"; // review access
  } else if (isPublished && study.visibility === "PUBLIC") {
    viewLevel = "limited";
  } else if (isPublished && study.visibility === "RESTRICTED" && isParticipant) {
    viewLevel = "limited";
  }

  if (viewLevel === "none") return NO_ACCESS;

  const actors = new Set<LifecycleActor>();
  if (hasFullAccess && isAuthor) actors.add("author");
  if (isManager) actors.add("orgManager");
  if (ctx.user.isPlatformAdmin) actors.add("platformAdmin");

  const allowedActions = (Object.keys(TRANSITIONS) as StudyAction[]).filter((action) => {
    const rule = TRANSITIONS[action];
    return rule.from.includes(study.status) && rule.actors.some((a) => actors.has(a));
  });

  const full = viewLevel === "full";
  const canWrite = full && !!membership && membership.role !== "VIEWER";
  const isLive = !TERMINAL_STATUSES.includes(study.status) && study.status !== "REJECTED";

  return {
    viewLevel,
    canView: true,
    canViewPrivate: full,
    canEdit: isEditable(study.status) && (isManager || (isAuthor && full)),
    canManageParticipants: isLive && (isManager || (isAuthor && full)),
    canWriteNotes: canWrite,
    canGenerateReports: full,
    allowedActions,
  };
}

/** Whether an actor class may perform an action from the study's current status. */
export function actorMayPerform(action: StudyAction, actor: LifecycleActor, study: Study): boolean {
  const rule = TRANSITIONS[action];
  return rule.from.includes(study.status) && rule.actors.includes(actor);
}

/** Members with ANALYST role or above in the active org can propose studies and edit watchlists. */
export function canProposeInActiveOrg(ctx: VcContext): boolean {
  return !!ctx.activeOrg && isProposerRole(ctx.activeOrg.role);
}

/**
 * Organization-level visibility used for alerts and watchlists, where there is
 * no single user: an org may follow its own studies and published PUBLIC ones.
 */
export function organizationCanFollowStudy(organizationId: string, study: Study): boolean {
  if (study.organizationId === organizationId) return true;
  return study.visibility === "PUBLIC" && PUBLISHED_STATUSES.includes(study.status);
}

/**
 * Whether a user may forecast in the market linked to a study. Exposed for
 * Engineer 2's forecast submission checks (see lib/vc/server/market-access.ts).
 */
export function canForecastOnStudy(
  userId: string,
  memberships: OrgMembership[],
  study: Study,
): boolean {
  if (study.status !== "OPEN") return false;
  if (study.visibility === "PUBLIC") return true;
  const membership = memberships.find((m) => m.organizationId === study.organizationId);
  if (study.visibility === "ORGANIZATION") return !!membership;
  return study.participantIds.includes(userId);
}

/** Strips private fields from a study for limited viewers. */
export function redactStudy(
  ctx: VcContext,
  study: Study,
  permissions: StudyPermissions,
): StudyView {
  const { participantIds, cancellationReason, rejectionReason, ...rest } = study;
  if (permissions.viewLevel === "full") {
    return { ...rest, participantIds, cancellationReason, rejectionReason, viewLevel: "full" };
  }
  return {
    ...rest,
    participantIds: null,
    cancellationReason: null,
    // Platform reviewers keep the review trail; other limited viewers never see it.
    rejectionReason: ctx.user.isPlatformAdmin ? rejectionReason : null,
    viewLevel: "limited",
  };
}

export type StudyView = Omit<Study, "participantIds"> & {
  participantIds: string[] | null;
  viewLevel: Exclude<ViewLevel, "none">;
};
