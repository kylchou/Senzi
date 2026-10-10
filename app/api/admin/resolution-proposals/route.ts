import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/auth";
import { listResolutionProposals } from "@/lib/resolutions";
import { proposalQuerySchema } from "@/lib/validation";

/** Proposals with their evidence. ?status=PROPOSED is the review queue. */
export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  return ok(await listResolutionProposals(admin, parseSearchParams(req, proposalQuerySchema)));
});
