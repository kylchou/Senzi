import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { createStartupFact, listStartupFacts } from "@/lib/admin-content";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { startupFactSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/admin/startups/[id]/facts">;

export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  return ok(await listStartupFacts(admin, id));
});

/** Body: { label, value, sourceName, sourceUrl, asOf, verified? } */
export const POST = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, startupFactSchema);
  return created(await createStartupFact(admin, id, input, { ip: clientIp(req) }));
});
