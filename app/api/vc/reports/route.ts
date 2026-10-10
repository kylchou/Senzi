import { z } from "zod";
import { ok, parseBody, parseQuery, withVc } from "@/lib/vc/server/http";
import { saveReportInput } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/vc/reports?studyId= — saved report snapshots for the active organization. */
export const GET = withVc(async ({ req, ctx, services }) => {
  const { studyId } = parseQuery(req, z.object({ studyId: z.string().min(1).optional() }));
  return ok(await services.reports.list(ctx, { studyId }));
});

/** POST /api/vc/reports — { studyId, title? } freezes a report snapshot. */
export const POST = withVc(async ({ req, ctx, services }) => {
  const { studyId, title } = await parseBody(req, saveReportInput);
  const saved = await services.reports.save(ctx, studyId, title);
  return ok({ id: saved.id, studyId: saved.studyId, title: saved.title, createdAt: saved.createdAt }, { status: 201 });
});
