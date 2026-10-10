import { exportResponse } from "@/lib/vc/server/export";
import { parseQuery, withVc } from "@/lib/vc/server/http";
import { z } from "zod";
import { reportFormat } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/studies/:studyId/report?format=json|markdown|csv — live report for the owning firm. */
export const GET = withVc<{ studyId: string }>(async ({ req, params, ctx, services }) => {
  const { format } = parseQuery(req, z.object({ format: reportFormat }));
  const report = await services.reports.generate(ctx, params.studyId);
  return exportResponse(report, format);
});
