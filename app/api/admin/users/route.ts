import { z } from "zod";
import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { searchUsersForAdmin } from "@/lib/admin";
import { requirePlatformAdmin } from "@/lib/auth";

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  return ok(await searchUsersForAdmin(admin, parseSearchParams(req, querySchema)));
});
