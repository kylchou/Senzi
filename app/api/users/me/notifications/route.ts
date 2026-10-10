import { z } from "zod";
import { ok, parseJsonBody, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/users";
import { idSchema, paginationSchema } from "@/lib/validation";

const querySchema = paginationSchema.extend({
  unread: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

const markReadSchema = z
  .object({ ids: z.union([z.literal("all"), z.array(idSchema).min(1).max(100)]) })
  .strict();

export const GET = withApiHandler(async (req) => {
  const user = await requireUser();
  const { unread, cursor, limit } = parseSearchParams(req, querySchema);
  const page = await listNotifications(user, { unreadOnly: unread, cursor, limit });
  return ok(page.items, { nextCursor: page.nextCursor, limit });
});

/** Body: { "ids": ["..."] } or { "ids": "all" } */
export const PATCH = withApiHandler(async (req) => {
  const user = await requireUser();
  const { ids } = await parseJsonBody(req, markReadSchema);
  return ok({ updated: await markNotificationsRead(user, ids) });
});
