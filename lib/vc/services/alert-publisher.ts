import { planNotifications, type CreatedAlert, type OrgMember } from "../alert-delivery";
import type { NewAlert, VcDeps } from "../ports";

/**
 * The single way VC alerts are created. Writes the firm's alert feed (deduped
 * per organization) and then copies each new alert into the inbox of every
 * member allowed to see it. The feed is the source of truth; inbox delivery is
 * best-effort, so a delivery failure never undoes or blocks the alert itself.
 */
export function createAlertPublisher(deps: VcDeps) {
  const { repo, platform } = deps;

  async function deliver(created: CreatedAlert[]) {
    const orgIds = [...new Set(created.map((a) => a.organizationId))];
    const studyIds = [...new Set(created.map((a) => a.studyId).filter((id): id is string => !!id))];
    const [members, studies] = await Promise.all([
      Promise.all(orgIds.map(async (id) => [id, await platform.listOrgMembers(id)] as [string, OrgMember[]])),
      studyIds.length ? repo.listStudies({ ids: studyIds }) : Promise.resolve([]),
    ]);
    const notifications = planNotifications(created, new Map(members), new Map(studies.map((s) => [s.id, s])));
    await platform.notifyUsers(notifications);
  }

  async function publish(alerts: NewAlert[]): Promise<CreatedAlert[]> {
    if (alerts.length === 0) return [];
    const created = await repo.createAlerts(alerts);
    if (created.length > 0) {
      try {
        await deliver(created);
      } catch (err) {
        console.error("[vc] inbox delivery failed; alerts are still in the firm feed", err);
      }
    }
    return created;
  }

  return { publish };
}

export type AlertPublisher = ReturnType<typeof createAlertPublisher>;
