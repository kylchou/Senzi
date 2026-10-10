import { z } from "zod";
import { MarketStatus } from "@/generated/prisma/enums";
import { created, ok, parseJsonBody, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { createMarket, listAdminMarkets } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { createMarketSchema, idSchema } from "@/lib/validation";

const querySchema = z.object({
  status: z.enum(MarketStatus).optional(),
  startupId: idSchema.optional(),
  q: z.string().trim().max(200).optional(),
});

/** Every market regardless of status or visibility. */
export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  return ok(await listAdminMarkets(admin, parseSearchParams(req, querySchema)));
});

/** Creates a DRAFT market, or an OPEN one when openImmediately is true. */
export const POST = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const input = await parseJsonBody(req, createMarketSchema);
  return created(await createMarket(admin, input, { ip: clientIp(req) }));
});
