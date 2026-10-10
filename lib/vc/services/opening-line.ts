import { createHash } from "node:crypto";
import type { AssistantModel } from "../assistant/model";
import { suggestMetric, type MetricSuggestion } from "../assistant/suggest-metric";
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
  /** The AI's proposed measurable form, when it found one. */
  suggestion: MetricSuggestion | null;
  /** Shown when no metric fits, e.g. "Funding rounds aren't in the model's data." */
  suggestionNote: string | null;
  estimate: EstimateView;
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
    asOf,
  };
}

export const NOT_MEASURABLE_NOTE =
  "Not enough data: none of the model's metrics for this startup measures this question, so it has no opening line. Forecasting can't open until it does.";

/**
 * The model-set opening line: links a question to a metric, runs the model,
 * and keeps open markets' model lines current. The AI only proposes links.
 */
export function createOpeningLineService(deps: VcDeps, assistantModel: AssistantModel | null) {
  const { repo, platform, model, now } = deps;

  async function startupOrThrow(startupId: string): Promise<StartupSummary> {
    const [startup] = await platform.getStartups([startupId]);
    if (!startup) throw new VcError("VALIDATION_ERROR", "Unknown startup", [{ path: "startupId", message: "Startup not found" }]);
    return startup;
  }

  /** Rejects links the model can't price as asked; returns the field errors as VALIDATION_ERROR. */
  function assertValidLink(startup: StartupSummary, link: MetricLink, observations: FirmObservation[], deadline: Date, path = "modelLink") {
    const metric = model.metricsFor(startup).find((m) => m.id === link.metricId);
    if (!metric) {
      throw new VcError("VALIDATION_ERROR", `The model has no metric "${link.metricId}" for ${startup.name}`, [
        { path: `${path}.metricId`, message: "Choose one of the listed metrics" },
      ]);
    }
    if (Date.parse(`${link.targetDate}T00:00:00Z`) <= deadline.getTime()) {
      throw new VcError("VALIDATION_ERROR", "The target date must be after the forecasting deadline", [
        { path: `${path}.targetDate`, message: "Must be after the forecasting deadline" },
      ]);
    }
    const stray = observations.findIndex((o) => o.metricId !== link.metricId);
    if (stray >= 0) {
      throw new VcError("VALIDATION_ERROR", "Your figures must be for the linked metric", [
        { path: `${path}.observations.${stray}.metricId`, message: `Only ${metric.label} figures affect this estimate` },
      ]);
    }
  }

  /** Runs the model for a study's question. Null link: not measurable. */
  async function estimateFor(
    startup: StartupSummary,
    link: MetricLink | null,
    observations: FirmObservation[],
    deadline: Date,
  ): Promise<ModelEstimate> {
    if (!link) return notMeasurable(now(), NOT_MEASURABLE_NOTE);
    assertValidLink(startup, link, observations, deadline);
    return model.estimate({ startup, link, observations, asOf: now() });
  }

  async function save(study: Pick<Study, "id">, estimate: ModelEstimate, observations: FirmObservation[], actorId: string | null) {
    const stored: StudyModelEstimate = { ...estimate, studyId: study.id, observations, calculatedById: actorId };
    await repo.saveModelEstimate(stored);
    return stored;
  }

  /** Draft-time preview: the AI proposes a link if none is given, then the model prices it. Saves nothing. */
  async function preview(ctx: VcContext, input: OpeningLinePreviewInput): Promise<OpeningLinePreview> {
    if (!ctx.activeOrg) throw forbidden("Select a VC organization first");
    if (!canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot propose studies");
    const startup = await startupOrThrow(input.startupId);
    const metrics = model.metricsFor(startup);

    let suggestion: MetricSuggestion | null = null;
    let suggestionNote: string | null = null;
    let link = input.link ?? null;
    if (!link) {
      if (!assistantModel) {
        suggestionNote = "Automatic matching isn't set up. Pick the metric that measures your question below.";
      } else {
        try {
          const result = await suggestMetric(assistantModel, {
            question: input.question,
            startupName: startup.name,
            metrics,
            today: now(),
            deadline: input.deadline,
            userKey: createHash("sha256").update(`senzi-tyche:${ctx.user.id}`).digest("hex"),
          });
          if (result.link) {
            suggestion = result as MetricSuggestion;
            link = result.link;
          } else {
            suggestionNote = result.reason || "None of the model's metrics measures this question.";
          }
        } catch (err) {
          console.error("[opening-line] metric suggestion failed", err);
          suggestionNote = "Automatic matching isn't available right now. Pick the metric that measures your question below.";
        }
      }
    }

    if (!link) return { metrics, suggestion, suggestionNote, estimate: toEstimateView(notMeasurable(now(), NOT_MEASURABLE_NOTE)) };
    assertValidLink(startup, link, input.observations, input.deadline, "link");
    const estimate = await model.estimate({ startup, link, observations: input.observations, asOf: now() });
    return { metrics, suggestion, suggestionNote, estimate: toEstimateView(estimate) };
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
      const next = await model.estimate({ startup, link: current.link, observations: current.observations, asOf: now() });
      if (next.status !== "OK" || next.inputsHash === current.inputsHash) continue;
      if (await model.publishUpdate(study.marketId, next)) published++;
      await save(study, next, current.observations, null);
    }
    return { checked, published };
  }

  return { estimateFor, save, preview, refreshOpenMarkets, metricsFor: (s: StartupSummary) => model.metricsFor(s) };
}

export type OpeningLineService = ReturnType<typeof createOpeningLineService>;
