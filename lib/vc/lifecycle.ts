/**
 * Research study lifecycle.
 * Approval, rejection and opening are performed by platform reviewers, not the
 * proposing firm, so firms cannot publish their own questions unreviewed.
 */
import { MAX_DEADLINE_LEAD_MS, MIN_DEADLINE_LEAD_MS } from "./constants";
import type { Study, StudyStatus } from "./types";

export type StudyAction =
  | "submit"
  | "withdraw"
  | "approve"
  | "reject"
  | "revise"
  | "open"
  | "close"
  | "resolve"
  | "cancel";

/** Who may perform an action. `author` = the proposing analyst, still a member of the firm. */
export type LifecycleActor = "author" | "orgManager" | "platformAdmin" | "system";

export interface TransitionRule {
  from: readonly StudyStatus[];
  to: StudyStatus;
  actors: readonly LifecycleActor[];
  requiresReason: boolean;
  label: string;
}

export const TRANSITIONS: Record<StudyAction, TransitionRule> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", actors: ["author", "orgManager"], requiresReason: false, label: "Submit for review" },
  withdraw: { from: ["SUBMITTED"], to: "DRAFT", actors: ["author", "orgManager"], requiresReason: false, label: "Withdraw to draft" },
  approve: { from: ["SUBMITTED"], to: "APPROVED", actors: ["platformAdmin"], requiresReason: false, label: "Approve" },
  reject: { from: ["SUBMITTED"], to: "REJECTED", actors: ["platformAdmin"], requiresReason: true, label: "Reject" },
  revise: { from: ["REJECTED"], to: "DRAFT", actors: ["author", "orgManager"], requiresReason: false, label: "Revise as draft" },
  open: { from: ["APPROVED"], to: "OPEN", actors: ["platformAdmin"], requiresReason: false, label: "Open forecasting" },
  close: { from: ["OPEN"], to: "CLOSED", actors: ["platformAdmin", "system"], requiresReason: false, label: "Close forecasting" },
  resolve: { from: ["OPEN", "CLOSED"], to: "RESOLVED", actors: ["system"], requiresReason: false, label: "Resolve" },
  cancel: {
    from: ["DRAFT", "SUBMITTED", "APPROVED"],
    to: "CANCELLED",
    actors: ["author", "orgManager", "platformAdmin"],
    requiresReason: true,
    label: "Cancel study",
  },
};

export function canTransitionFrom(action: StudyAction, status: StudyStatus): boolean {
  return TRANSITIONS[action].from.includes(status);
}

export function actionsFrom(status: StudyStatus): StudyAction[] {
  return (Object.keys(TRANSITIONS) as StudyAction[]).filter((a) => canTransitionFrom(a, status));
}

/** Only drafts can be edited; everything after submission is frozen for review integrity. */
export const isEditable = (status: StudyStatus) => status === "DRAFT";

/**
 * Problems that block a transition beyond the status/actor check, e.g. a study
 * that is incomplete or whose deadline has already passed. Empty array = OK.
 */
export function getTransitionIssues(action: StudyAction, study: Study, now: Date): string[] {
  const issues: string[] = [];
  // The opening line isn't checked here: the model sets it when forecasting
  // opens, and the study service blocks opening when it has too little data.
  if (action === "submit" || action === "approve" || action === "open") {
    if (!study.sources.length) issues.push("A named third-party resolution source is required.");
    if (study.visibility === "RESTRICTED" && study.participantIds.length === 0) {
      issues.push("Restricted studies need at least one invited participant.");
    }
    const deadlineIssue = checkDeadline(study.deadline, now);
    if (deadlineIssue) issues.push(deadlineIssue);
  }
  return issues;
}

/** Returns a message if the deadline is too soon or too far away, otherwise null. */
export function checkDeadline(deadline: Date, now: Date): string | null {
  const lead = deadline.getTime() - now.getTime();
  if (lead < MIN_DEADLINE_LEAD_MS) return "The deadline must be at least 24 hours in the future.";
  if (lead > MAX_DEADLINE_LEAD_MS) return "The deadline must be within 3 years.";
  return null;
}

/** Timestamp fields set when a study enters a status. */
export function timestampPatchFor(to: StudyStatus, now: Date): Partial<Study> {
  switch (to) {
    case "SUBMITTED":
      return { submittedAt: now };
    case "APPROVED":
      return { approvedAt: now };
    case "OPEN":
      return { openedAt: now };
    case "CLOSED":
      return { closedAt: now };
    case "RESOLVED":
      return { resolvedAt: now };
    case "DRAFT":
      // Returning to draft clears the review trail fields so the next submission starts fresh.
      return { submittedAt: null, rejectionReason: null };
    default:
      return {};
  }
}
