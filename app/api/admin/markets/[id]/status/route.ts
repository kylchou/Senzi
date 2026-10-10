import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { changeMarketStatus } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { marketStatusChangeSchema } from "@/lib/validation";

/** Body: { status: "OPEN" | "CLOSED" | "CANCELLED", reason? } */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/markets/[id]/status">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, marketStatusChangeSchema);
  return ok(await changeMarketStatus(admin, id, input, { ip: clientIp(req) }));
});
