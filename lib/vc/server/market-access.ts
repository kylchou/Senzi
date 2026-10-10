/**
 * Study-aware market access, exported:
 *  - Call `getStudyMarketAccess` in forecast submission so only
 *    eligible users can forecast on markets opened from private studies.
 *  - Markets with `visibility !== "PUBLIC"` must be excluded from
 *    public listings; this helper is the per-market check.
 */
import { canForecastOnStudy, getStudyPermissions } from "../permissions";
import type { StudyVisibility } from "../types";
import { getVcDeps } from "./container";

export type StudyMarketAccess =
  | { linked: false }
  | { linked: true; studyId: string; visibility: StudyVisibility; canView: boolean; canForecast: boolean };

export async function getStudyMarketAccess(marketId: string, userId: string | null): Promise<StudyMarketAccess> {
  const { repo, platform } = getVcDeps();
  const study = await repo.findStudyByMarketId(marketId);
  if (!study) return { linked: false };

  if (!userId) {
    const isPublic = study.visibility === "PUBLIC";
    return { linked: true, studyId: study.id, visibility: study.visibility, canView: isPublic, canForecast: false };
  }

  const memberships = await platform.getMemberships(userId);
  const ctx = {
    user: { id: userId, name: null, email: null, isPlatformAdmin: false },
    memberships,
    activeOrg: null,
  };
  return {
    linked: true,
    studyId: study.id,
    visibility: study.visibility,
    canView: getStudyPermissions(ctx, study).canView,
    canForecast: canForecastOnStudy(userId, memberships, study),
  };
}
