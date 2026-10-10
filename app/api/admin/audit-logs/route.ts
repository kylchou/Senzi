import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { listAuditLogs } from "@/lib/admin";
import { requirePlatformAdmin } from "@/lib/auth";
import { auditLogQuerySchema } from "@/lib/validation";

export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const query = parseSearchParams(req, auditLogQuerySchema);
  const page = await listAuditLogs(admin, query);
  return ok(page.items, { nextCursor: page.nextCursor, limit: query.limit });
});
