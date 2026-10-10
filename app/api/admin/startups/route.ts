import { z } from "zod";
import { created, ok, parseJsonBody, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { createStartup, listAdminStartups } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { createStartupSchema } from "@/lib/validation";

/** All startups, including unpublished ones. */
export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const { q } = parseSearchParams(req, z.object({ q: z.string().trim().max(120).optional() }));
  return ok(await listAdminStartups(admin, { q }));
});

export const POST = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const input = await parseJsonBody(req, createStartupSchema);
  return created(await createStartup(admin, input, { ip: clientIp(req) }));
});
