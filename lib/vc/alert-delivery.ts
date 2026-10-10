/**
 * Decides who gets a personal inbox notification for each new VC alert.
 * Pure, so the recipient rules can be tested without a database.
 *
 * Rules:
 *  - Only current members of the alert's organization are considered.
 *  - Alerts about a study go only to members who can view that study
 *    (getStudyPermissions), so restricted studies never reach the wrong inbox.
 *  - Status changes go only to the study's author and the firm's owners/admins;
 *    everything else goes to every member who can see it.
 */
import { getStudyPermissions, isManagerRole } from "./permissions";
import type { AlertType, OrgRole, Study, VcAlert, VcContext } from "./types";

export type CreatedAlert = Omit<VcAlert, "readAt">;

/** Shared NotificationType values that best describe each VC alert type. */
export type InboxType = "MARKET_CLOSING" | "MARKET_RESOLVED" | "SYSTEM";

const INBOX_TYPE: Record<AlertType, InboxType> = {
  DEADLINE_APPROACHING: "MARKET_CLOSING",
  STUDY_RESOLVED: "MARKET_RESOLVED",
  FORECAST_MOVEMENT: "SYSTEM",
  STUDY_STATUS_CHANGED: "SYSTEM",
};

export interface PersonalNotification {
  userId: string;
  type: InboxType;
  title: string;
  body: string;
  link: string;
  data: { vcAlertId: string; organizationId: string; studyId: string | null; alertType: AlertType };
}

export interface OrgMember {
  userId: string;
  role: OrgRole;
}

/** Minimal context for evaluating one member's view of a study in their own org. */
function memberContext(organizationId: string, member: OrgMember): VcContext {
  const membership = { organizationId, organizationName: "", role: member.role };
  return {
    user: { id: member.userId, name: null, email: null, isPlatformAdmin: false },
    memberships: [membership],
    activeOrg: membership,
  };
}

export function planNotifications(
  alerts: CreatedAlert[],
  membersByOrg: Map<string, OrgMember[]>,
  studiesById: Map<string, Study>,
): PersonalNotification[] {
  const out: PersonalNotification[] = [];
  for (const alert of alerts) {
    const study = alert.studyId ? studiesById.get(alert.studyId) : undefined;
    // A study alert whose study is gone is not delivered.
    if (alert.studyId && !study) continue;

    for (const member of membersByOrg.get(alert.organizationId) ?? []) {
      if (study && !getStudyPermissions(memberContext(alert.organizationId, member), study).canView) continue;
      if (
        alert.type === "STUDY_STATUS_CHANGED" &&
        !(isManagerRole(member.role) || study?.createdById === member.userId)
      ) {
        continue;
      }
      out.push({
        userId: member.userId,
        type: INBOX_TYPE[alert.type],
        title: alert.title,
        body: alert.body,
        link: alert.studyId ? `/vc/studies/${alert.studyId}` : "/vc/alerts",
        data: {
          vcAlertId: alert.id,
          organizationId: alert.organizationId,
          studyId: alert.studyId,
          alertType: alert.type,
        },
      });
    }
  }
  return out;
}
