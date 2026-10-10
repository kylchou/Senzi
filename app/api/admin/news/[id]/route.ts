import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { deleteNewsItem, getAdminNewsItem, updateNewsItem } from "@/lib/admin-content";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { updateNewsItemSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/admin/news/[id]">;

export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  return ok(await getAdminNewsItem(admin, id));
});

/** Edit, or set { verification: "VERIFIED" | "UNVERIFIED" | "DISPUTED" }. */
export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, updateNewsItemSchema);
  return ok(await updateNewsItem(admin, id, input, { ip: clientIp(req) }));
});

export const DELETE = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  await deleteNewsItem(admin, id, { ip: clientIp(req) });
  return ok({ deleted: true });
});
