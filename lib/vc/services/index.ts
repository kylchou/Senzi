import type { VcDeps } from "../ports";
import { createAlertService } from "./alerts";
import { createCompareService } from "./compare";
import { createDashboardService } from "./dashboard";
import { createReportService } from "./reports";
import { createStudyService } from "./studies";
import { createWatchlistService } from "./watchlists";

export function createVcServices(deps: VcDeps) {
  const studies = createStudyService(deps);
  const watchlists = createWatchlistService(deps);
  const alerts = createAlertService(deps);
  const reports = createReportService(deps);
  const dashboard = createDashboardService(deps, { alerts, reports });
  const compare = createCompareService(deps);
  return { studies, watchlists, alerts, reports, dashboard, compare };
}

export type VcServices = ReturnType<typeof createVcServices>;
