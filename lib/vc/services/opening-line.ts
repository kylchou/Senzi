import { VcError, forbidden } from "../errors";
import { OPENING_LINE_MODEL_NAME } from "../opening-line";
import { canProposeInActiveOrg } from "../permissions";
import type { VcDeps } from "../ports";
import type {
  FirmObservation,
  MetricLink,
  ModelEstimate,
  OpeningLineMetric,
  StartupSummary,
  Study,
  StudyModelEstimate,
  VcContext,
} from "../types";
import type { OpeningLinePreviewInput } from "../validation";

/** Most open studies whose model line is refreshed per cron run. */
export const MODEL_REFRESH_BATCH = 50;

/** What the firm sees of an estimate. Leaves out inputsUsed, which can hold other sources' raw rows. */
export type EstimateView = Omit<ModelEstimate, "inputsUsed">;

export interface OpeningLinePreview {
  metrics: OpeningLineMetric[];
  estimate: EstimateView;
  /** How many of the firm's own figures fed this estimate (entered on the company page). */
  firmFigureCount: number;
  /** Where the firm adds its own figures for this startup. */
  companyPath: string;
}

export function toEstimateView(estimate: ModelEstimate): EstimateView {
  const view: Partial<ModelEstimate> = { ...estimate };
  delete view.inputsUsed;
  return view as EstimateView;
}

export function notMeasurable(asOf: Date, note: string): ModelEstimate {
  return {
    status: "NOT_MEASURABLE",
    link: null,
    probability: null,
    low: null,
    high: null,
    confidence: null,
    modelName: OPENING_LINE_MODEL_NAME,
    modelVersion: "direct-metric",
    inputsHash: null,
    methodology: null,
    notes: [note],
    inputsUsed: [],
    question: null,
    yesCriteria: null,
    noCriteria: null,
    resolutionSource: null,
    asOf,
  };
}

export const NOT_MEASURABLE_NOTE =
  "Not enough data: none of the model's metrics for this startup measures this question, so it has no opening line. Forecasting can't open until it does.";

/**
 * The model-set opening line: prices a question's outcome with the model and
 * keeps open markets' model lines current.
 */
export function createOpeningLineService(deps: VcDeps) {
  const { repo, platform, model, now } = deps;

  async function startupOrThrow(startupId: string): Promise<StartupSummary> {
    const [startup] = await platform.getStartups([startupId]);
    if (!startup) throw new VcError("VALIDATION_ERROR", "Unknown startup", [{ path: "startupId", message: "Startup not found" }]);
    return startup;
  }

  /** Rejects links the model can't price as asked; returns the field errors as VALIDATION_ERROR. */
  function assertValidLink(startup: StartupSummary, link: MetricLink, deadline: Date, path = "modelLink") {
    if (!model.metricsFor(startup).some((m) => m.id === link.metricId)) {
      throw new VcError("VALIDATION_ERROR", `No metric "${link.metricId}" with a public resolution source exists for ${startup.name}`, [
        { path: `${path}.metricId`, message: "Choose one of the listed metrics" },
      ]);
    }
    if (Date.parse(`${link.targetDate}T00:00:00Z`) <= deadline.getTime()) {
      throw new VcError("VALIDATION_ERROR", "The target date must be after the forecasting deadline", [
        { path: `${path}.targetDate`, message: "Must be after the forecasting deadline" },
      ]);
    }
  }

  /** The firm's own figures for the linked metric, from its company page. */
  async function firmFigures(organizationId: string, startupId: string, link: MetricLink): Promise<FirmObservation[]> {
    return (await repo.listFirmFigures(organizationId, startupId)).filter((o) => o.metricId === link.metricId);
  }

  /**
   * Runs the model for a firm's study question with its company-page figures.
   * Null link: not measurable. Returns the figures used, for the record.
   */
  async function estimateFor(
    organizationId: string,
    startup: StartupSummary,
    link: MetricLink | null,
    deadline: Date,
  ): Promise<{ estimate: ModelEstimate; figures: FirmObservation[] }> {
    if (!link) return { estimate: notMeasurable(now(), NOT_MEASURABLE_NOTE), figures: [] };
    assertValidLink(startup, link, deadline);
    const figures = await firmFigures(organizationId, startup.id, link);
    return { estimate: await model.estimate({ startup, link, observations: figures, asOf: now() }), figures };
  }

  async function save(study: Pick<Study, "id">, estimate: ModelEstimate, figures: FirmObservation[], actorId: string | null) {
    const stored: StudyModelEstimate = { ...estimate, studyId: study.id, observations: figures, calculatedById: actorId };
    await repo.saveModelEstimate(stored);
    return stored;
  }

  /** Draft-time preview: the model prices the chosen outcome. Saves nothing. */
  async function preview(ctx: VcContext, input: OpeningLinePreviewInput): Promise<OpeningLinePreview> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    if (!canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot propose studies");
    const organizationId = ctx.activeOrg.organizationId;
    const startup = await startupOrThrow(input.startupId);
    const metrics = model.metricsFor(startup);
    assertValidLink(startup, input.link, input.deadline, "link");
    const figures = await firmFigures(organizationId, startup.id, input.link);
    const estimate = await model.estimate({ startup, link: input.link, observations: figures, asOf: now() });
    return { metrics, estimate: toEstimateView(estimate), firmFigureCount: figures.length, companyPath: `/vc/companies/${startup.slug}` };
  }

  /**
   * Re-runs the model for open study markets and publishes changed estimates
   * to their model lines. An estimate that drops to insufficient data leaves
   * the last published value in place.
   */
  async function refreshOpenMarkets(): Promise<{ checked: number; published: number }> {
    const open = (await repo.listStudies({ statuses: ["OPEN"], hasMarket: true })).slice(0, MODEL_REFRESH_BATCH);
    const stored = new Map((await repo.findModelEstimates(open.map((s) => s.id))).map((e) => [e.studyId, e]));
    const startups = new Map((await platform.getStartups([...new Set(open.map((s) => s.startupId))])).map((s) => [s.id, s]));
    let checked = 0;
    let published = 0;
    for (const study of open) {
      const current = stored.get(study.id);
      const startup = startups.get(study.startupId);
      if (!current?.link || !startup || !study.marketId) continue;
      checked++;
      // Picks up new public data and anything the firm added on its company page since.
      const figures = await firmFigures(study.organizationId, startup.id, current.link);
      const next = await model.estimate({ startup, link: current.link, observations: figures, asOf: now() });
      if (next.status !== "OK" || next.inputsHash === current.inputsHash) continue;
      if (await model.publishUpdate(study.marketId, next)) published++;
      await save(study, next, figures, null);
    }
    return { checked, published };
  }

  /**
   * Startups a question can be asked about: those with at least one outcome the
   * model has public data for, so an opening price is always possible.
   */
  async function questionCatalog(): Promise<{ startup: StartupSummary; metrics: OpeningLineMetric[] }[]> {
    const startups = await platform.searchStartups("", 500);
    return startups
      .map((startup) => ({ startup, metrics: model.metricsFor(startup).filter((m) => m.hasPublicData) }))
      .filter((entry) => entry.metrics.length > 0);
  }

  return { estimateFor, save, preview, refreshOpenMarkets, questionCatalog, metricsFor: (s: StartupSummary) => model.metricsFor(s) };
}

export type OpeningLineService = ReturnType<typeof createOpeningLineService>;
