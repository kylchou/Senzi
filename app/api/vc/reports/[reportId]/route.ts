import { z } from "zod";
import { exportResponse } from "@/lib/vc/server/export";
import { parseQuery, withVc } from "@/lib/vc/server/http";
import { reportFormat } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/vc/reports/:reportId?format=json|markdown|csv — export a saved snapshot. */
export const GET = withVc<{ reportId: string }>(async ({ req, params, ctx, services }) => {
  const { format } = parseQuery(req, z.object({ format: reportFormat }));
  const report = await services.reports.get(ctx, params.reportId);
  return exportResponse(report.content, format);
});
