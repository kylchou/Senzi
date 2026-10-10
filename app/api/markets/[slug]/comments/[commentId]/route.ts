import { notFound, ok, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { findDiscussionMarket, removeComment } from "@/lib/market-view/discussion";

/** Removes a comment. Its author or a platform admin only. */
export const DELETE = withApiHandler(
  async (req, { params }: RouteContext<"/api/markets/[slug]/comments/[commentId]">) => {
    const user = await requireUser();
    const { slug, commentId } = await params;
    const market = await findDiscussionMarket(slug);
    if (!market) throw notFound("Market");
    await removeComment(market, user, commentId, clientIp(req));
    return ok({ id: commentId, removed: true });
  },
);
