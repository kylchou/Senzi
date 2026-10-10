import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { addMember, listMembers } from "@/lib/organizations";
import { addMemberSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/organizations/[orgId]/members">;

/** Any member can see the member list. */
export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId } = await ctx.params;
  return ok(await listMembers(user, orgId));
});

/** ADMIN+ adds a member by email (invites them if they have no account yet). */
export const POST = withApiHandler(async (req, ctx: Ctx) => {
  const user = await requireUser();
  const { orgId } = await ctx.params;
  const input = await parseJsonBody(req, addMemberSchema);
  return created(await addMember(user, orgId, input, { ip: clientIp(req) }));
});
