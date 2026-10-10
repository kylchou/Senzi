import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { deleteOrganization, getOrganization, updateOrganization } from "@/lib/organizations";
import { updateOrganizationSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/organizations/[orgId]">;

export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId } = await ctx.params;
  return ok(await getOrganization(user, orgId));
});

/** ADMIN or OWNER. */
export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId } = await ctx.params;
  const input = await parseJsonBody(req, updateOrganizationSchema);
  return ok(await updateOrganization(user, orgId, input, { ip: clientIp(req) }));
});

/** OWNER only. Deletes studies, watchlists, and memberships with it. */
export const DELETE = withApiHandler(async (req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId } = await ctx.params;
  await deleteOrganization(user, orgId, { ip: clientIp(req) });
  return ok({ deleted: true });
});
