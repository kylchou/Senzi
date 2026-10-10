import { ok, withVc } from "@/lib/vc/server/http";

/** GET /api/studies/review-queue — submitted and approved studies awaiting platform review. */
export const GET = withVc(async ({ ctx, services }) => ok(await services.studies.listReviewQueue(ctx)));
