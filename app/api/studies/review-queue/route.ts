import { ok, withVc } from "@/lib/vc/server/http";

export const dynamic = "force-dynamic";

/** GET /api/studies/review-queue — submitted and approved studies awaiting platform review. */
export const GET = withVc(async ({ ctx, services }) => ok(await services.studies.listReviewQueue(ctx)));
