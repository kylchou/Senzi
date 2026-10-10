// Public API of the model.
//
//   getBaseline(questionId)  -> opening baseline with band, inputs, sources, method
//   refreshBaseline(...)     -> recompute and store a snapshot only if inputs changed
//   toEngineBaseline(result) -> the shape the forecasting engine's recordModelValue takes
//   getCompanyIndicators(..) -> indicators panel rows for the VC dashboard

import { computeBaseline, type BaselineOptions } from './baseline';
import { FileModelStore, type ModelStore } from './store';
import type { BaselineResult } from './types';

export interface GetBaselineOptions extends Omit<BaselineOptions, 'sponsorPoints' | 'npmIndexPoints'> {
  asOf?: Date;
  store?: ModelStore;
}

export class QuestionNotFoundError extends Error {
  constructor(readonly questionId: string) {
    super(`Question "${questionId}" not found`);
    this.name = 'QuestionNotFoundError';
  }
}

export function getBaseline(questionId: string, options: GetBaselineOptions = {}): BaselineResult {
  const store = options.store ?? new FileModelStore();
  const question = store.readQuestions().find((q) => q.id === questionId);
  if (!question) throw new QuestionNotFoundError(questionId);
  return computeBaseline(question, store.readPoints(question.companyId), options.asOf ?? new Date(), {
    ...(options.params ? { params: options.params } : {}),
    sponsorPoints: store.readSponsorPoints(question.companyId),
    npmIndexPoints: store.readNpmIndexPoints(),
  });
}

/**
 * Computes the baseline and stores it only when its inputs differ from the
 * last stored snapshot for that question, so the baseline moves only when new
 * data arrives. Returns the current baseline and whether it changed.
 */
export function refreshBaseline(questionId: string, options: GetBaselineOptions = {}): { result: BaselineResult; changed: boolean } {
  const store = options.store ?? new FileModelStore();
  const result = getBaseline(questionId, { ...options, store });
  const previous = store
    .readBaselineSnapshots()
    .filter((s) => s.questionId === questionId)
    .at(-1);
  if (previous && previous.method.details.inputsHash === result.method.details.inputsHash) {
    return { result: previous, changed: false };
  }
  store.appendBaselineSnapshot(result);
  return { result, changed: true };
}

/** Matches the forecasting engine's `Baseline` (src/forecasting/types.ts). Null when there's no number. */
export function toEngineBaseline(result: BaselineResult): {
  value: number;
  asOf: Date;
  modelVersion: string;
  inputsNote: string;
} | null {
  if (result.probability === null) return null;
  const inputs = result.inputsUsed
    .map((i) => `${i.metricId} (${i.provenance === 'sponsor_provided' ? 'sponsor-provided' : 'scraped'}, ${i.points} pts)`)
    .join('; ');
  return {
    value: result.probability,
    asOf: new Date(result.asOf),
    modelVersion: `${result.method.name}@${result.method.version}`,
    inputsNote: inputs,
  };
}

/**
 * The `Market` columns the model writes (prisma/schema.prisma). `openingBaseline`
 * only applies until the first forecast; the caller must not write it after that.
 * Null when the model has no number for the question.
 */
export function toMarketModelFields(result: BaselineResult): {
  openingBaseline: number;
  baselineMethodology: string;
  baselineSetAt: Date;
  modelValue: number;
  modelVersion: string;
  modelInputsNote: string;
  modelUpdatedAt: Date;
} | null {
  const e = toEngineBaseline(result);
  if (!e) return null;
  return {
    openingBaseline: e.value,
    baselineMethodology: `${result.method.description} Inputs: ${e.inputsNote}. Model uncertainty band: ${Math.round(result.low! * 100)}%–${Math.round(result.high! * 100)}%.`,
    baselineSetAt: e.asOf,
    modelValue: e.value,
    modelVersion: e.modelVersion,
    modelInputsNote: e.inputsNote,
    modelUpdatedAt: e.asOf,
  };
}

export { computeBaseline, METHOD_DESCRIPTION, NPM_INDEX_DESCRIPTION } from './baseline';
export { getCompanyIndicators, getIndicatorHistory, type Indicator, type IndicatorHistory } from './indicators';
export { crossCheckSponsor, sponsorPoint, sponsorLabel, type SponsorEntry } from './sponsor';
export { makeQuestion, questionText, resolveQuestion, type Resolution } from './questions';
export { COMPANIES, getCompany, metricIds, metricsFor, NPM_INDEX_PACKAGES } from './catalog';
export { npmAdjustedHistory, type NpmAdjustedWeek } from './npm-index';
export { defaultParams, MODEL_NAME, MODEL_VERSION, type ModelParams } from './params';
export { FileModelStore, MemoryModelStore, type ModelStore } from './store';
export type * from './types';
