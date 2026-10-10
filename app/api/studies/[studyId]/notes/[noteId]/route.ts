import { ok, withVc } from "@/lib/vc/server/http";

export const dynamic = "force-dynamic";

/** DELETE /api/studies/:studyId/notes/:noteId — author or org manager only. */
export const DELETE = withVc<{ studyId: string; noteId: string }>(async ({ params, ctx, services }) => {
  await services.studies.deleteNote(ctx, params.studyId, params.noteId);
  return ok({ deleted: true });
});
