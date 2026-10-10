import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { companyModel, companyMetricsInput, saveCompanyMetrics } from "@/lib/vc/server/company-model";

type Params = { startupId: string };
function publicResponse(data: Awaited<ReturnType<typeof companyModel>>) {
  return { startup: data.startup, metrics: data.metrics, questionMetrics: data.questionMetrics, sponsor: data.sponsor, indicators: data.indicators, crossChecks: data.crossChecks };
}
export const GET = withVc<Params>(async ({ ctx, params }) => ok(publicResponse(await companyModel(ctx, params.startupId))));
export const PUT = withVc<Params>(async ({ ctx, params, req }) => ok(publicResponse(await saveCompanyMetrics(ctx, params.startupId, await parseBody(req, companyMetricsInput)))));
