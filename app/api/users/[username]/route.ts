import { ok, withApiHandler } from "@/lib/api-response";
import { getPublicProfile } from "@/lib/users";

/** Public profile by username (or user id). No email or balance. */
export const GET = withApiHandler(async (_req, ctx: RouteContext<"/api/users/[username]">) => {
  const { username } = await ctx.params;
  return ok(await getPublicProfile(username));
});
