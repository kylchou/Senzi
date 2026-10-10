import { z } from "zod";
import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { setAccountType, setPlatformRole } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { setAccountTypeSchema, setPlatformRoleSchema } from "@/lib/validation";

const bodySchema = z.union([setPlatformRoleSchema, setAccountTypeSchema]);

/**
 * Body: { platformRole: "USER" | "ADMIN" } or { accountType: "VC" | "TRADER", reason }.
 * Admins cannot change their own role or account type.
 */
export const PATCH = withApiHandler(async (req, ctx: RouteContext<"/api/admin/users/[id]">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const body = await parseJsonBody(req, bodySchema);
  return ok(
    "platformRole" in body
      ? await setPlatformRole(admin, id, body.platformRole, { ip: clientIp(req) })
      : await setAccountType(admin, id, body, { ip: clientIp(req) }),
  );
});
