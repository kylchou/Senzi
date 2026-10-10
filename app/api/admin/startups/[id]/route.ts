import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { getAdminStartup, updateStartup } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { updateStartupSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/admin/startups/[id]">;

export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  return ok(await getAdminStartup(admin, id));
});

export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, updateStartupSchema);
  return ok(await updateStartup(admin, id, input, { ip: clientIp(req) }));
});
