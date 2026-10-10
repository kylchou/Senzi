import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { setPlatformRole } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { setPlatformRoleSchema } from "@/lib/validation";

/** Body: { platformRole: "USER" | "ADMIN" }. Admins cannot change their own role. */
export const PATCH = withApiHandler(async (req, ctx: RouteContext<"/api/admin/users/[id]">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { platformRole } = await parseJsonBody(req, setPlatformRoleSchema);
  return ok(await setPlatformRole(admin, id, platformRole, { ip: clientIp(req) }));
});
