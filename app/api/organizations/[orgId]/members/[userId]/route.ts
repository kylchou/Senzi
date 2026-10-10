import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { changeMemberRole, removeMember } from "@/lib/organizations";
import { updateMemberRoleSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/organizations/[orgId]/members/[userId]">;

export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId, userId } = await ctx.params;
  const { role } = await parseJsonBody(req, updateMemberRoleSchema);
  return ok(await changeMemberRole(user, orgId, userId, role, { ip: clientIp(req) }));
});

/** Remove a member, or leave the organization when userId is your own id. */
export const DELETE = withApiHandler(async (req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId, userId } = await ctx.params;
  await removeMember(user, orgId, userId, { ip: clientIp(req) });
  return ok({ removed: true });
});
