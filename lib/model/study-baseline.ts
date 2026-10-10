import { computeDirectBaseline, type DirectBaseline } from './direct-baseline';
import { intakeMetrics, intakeQuestionSchema, questionTextFor } from './intake';
import type { DataPoint } from './types';

/** Public-safe methodology; raw sponsor values stay in private intake storage. */
export function baselineMethodology(result: DirectBaseline): string {
  return `Model ${result.modelVersion}: robust trend using only the question's metric. May include sponsor-provided history. Model uncertainty band ${Math.round(result.low! * 100)}–${Math.round(result.high! * 100)}%. As of ${result.asOf}. Inputs and detailed methodology are private to the sponsor. Trades do not affect this model.`;
}

/** Verify the exact saved evidence before copying a reviewed baseline into a market. */
export function verifyStudyBaseline(record: { question: unknown; inputSnapshot: unknown; result: unknown; calculatedAt: Date }, startup: { id: string; name: string; slug: string }, study: { question: string; deadline: Date; baselineValue: number | null; baselineMethodology: string | null }) {
  const question = intakeQuestionSchema.parse(record.question);
  const metric = intakeMetrics(startup).find(m => m.id === question.metricId);
  if (!metric || !record.result || !Array.isArray(record.inputSnapshot)) throw new Error('Recalculate the model baseline before opening');
  const saved = record.result as DirectBaseline;
  const result = computeDirectBaseline(startup.id, question, metric, record.inputSnapshot as DataPoint[], record.calculatedAt);
  if (result.status !== 'ok' || saved.inputsHash !== result.inputsHash || saved.probability !== result.probability || study.baselineValue !== result.probability || study.baselineMethodology !== baselineMethodology(result) || study.question !== questionTextFor(startup.name, metric, question)) throw new Error('The saved baseline no longer matches the approved inputs');
  if (study.deadline.getTime() >= Date.parse(`${question.targetDate}T00:00:00Z`)) throw new Error('Forecasting must close before the target window ends');
  return { question, metric, result };
}
