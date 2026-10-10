import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { deleteStartupFact, updateStartupFact } from "@/lib/admin-content";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { updateStartupFactSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/admin/facts/[factId]">;

/** Edit a fact, or mark it verified with { verified: true }. */
export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { factId } = await ctx.params;
  const input = await parseJsonBody(req, updateStartupFactSchema);
  return ok(await updateStartupFact(admin, factId, input, { ip: clientIp(req) }));
});

export const DELETE = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { factId } = await ctx.params;
  await deleteStartupFact(admin, factId, { ip: clientIp(req) });
  return ok({ deleted: true });
});
