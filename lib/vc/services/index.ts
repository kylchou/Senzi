import type { DataTier } from "../assistant/types";
import type { VcDeps } from "../ports";
import { createAssistantContextService } from "./assistant-context";
import { createAlertService } from "./alerts";
import { createCompareService } from "./compare";
import { createDashboardService } from "./dashboard";
import { createReportService } from "./reports";
import { createStudyService } from "./studies";
import { createWatchlistService } from "./watchlists";

export function createVcServices(deps: VcDeps, options: { assistantTier?: DataTier } = {}) {
  const studies = createStudyService(deps);
  const watchlists = createWatchlistService(deps);
  const alerts = createAlertService(deps);
  const reports = createReportService(deps);
  const dashboard = createDashboardService(deps, { alerts, reports });
  const compare = createCompareService(deps);
  const assistantContext = createAssistantContextService(deps, { studies, compare }, { tier: options.assistantTier ?? "standard" });
  return { studies, watchlists, alerts, reports, dashboard, compare, assistantContext };
}

export type VcServices = ReturnType<typeof createVcServices>;
