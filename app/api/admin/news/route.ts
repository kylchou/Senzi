import { created, ok, parseJsonBody, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { createNewsItem, listAdminNews } from "@/lib/admin-content";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { newsItemSchema, newsQuerySchema } from "@/lib/validation";

/** Newest first, up to 200. Filters: ?q=&startupId=&verification= */
export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  return ok(await listAdminNews(admin, parseSearchParams(req, newsQuerySchema)));
});

export const POST = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const input = await parseJsonBody(req, newsItemSchema);
  return created(await createNewsItem(admin, input, { ip: clientIp(req) }));
});
