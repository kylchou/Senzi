import type { VcDeps } from "../ports";
import { createAlertService } from "./alerts";
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
  return { studies, watchlists, alerts, reports, dashboard };
}

export type VcServices = ReturnType<typeof createVcServices>;
