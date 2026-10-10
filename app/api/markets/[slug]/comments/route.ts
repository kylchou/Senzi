import { created, notFound, ok, parseJsonBody, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { createComment, findDiscussionMarket, listComments } from "@/lib/market-view/discussion";
import { createCommentSchema, listCommentsSchema } from "@/lib/market-view/discussion-types";

/** A market's discussion: newest top-level comments first, each with its replies. */
export const GET = withApiHandler(async (req, { params }: RouteContext<"/api/markets/[slug]/comments">) => {
  const market = await findDiscussionMarket((await params).slug);
  if (!market) throw notFound("Market");
  const query = parseSearchParams(req, listCommentsSchema);
  return ok(await listComments(market, await getCurrentUser(), query));
});

/** Posts a comment, or a reply when parentId is set. Body: { body, parentId? }. */
export const POST = withApiHandler(async (req, { params }: RouteContext<"/api/markets/[slug]/comments">) => {
  const user = await requireUser();
  const market = await findDiscussionMarket((await params).slug);
  if (!market) throw notFound("Market");
  const input = await parseJsonBody(req, createCommentSchema);
  return created(await createComment(market, user, input));
});
