import { z } from 'zod';
import { COMPANIES } from './catalog';
import { addDays } from './dates';

export interface IntakeMetric { id: string; label: string; unit: string; kind: 'snapshot' | 'weekly_total'; sourceUrl: string | null }
export const KPI_METRICS: IntakeMetric[] = [
  { id: 'sponsor_arr', label: 'ARR', unit: 'USD/year', kind: 'snapshot', sourceUrl: null },
  { id: 'sponsor_mrr', label: 'MRR', unit: 'USD/month', kind: 'snapshot', sourceUrl: null },
  { id: 'sponsor_registered_users', label: 'Registered users', unit: 'users', kind: 'snapshot', sourceUrl: null },
  { id: 'sponsor_mau', label: 'Monthly active users (trailing 30 days)', unit: 'users', kind: 'snapshot', sourceUrl: null },
];

export function intakeMetrics(startup: { slug: string; name: string }): IntakeMetric[] {
  const company = COMPANIES.find(c => c.id === startup.slug || c.name.toLowerCase() === startup.name.toLowerCase());
  return [...KPI_METRICS,
    ...(company?.npmPackages ?? []).map(pkg => ({ id: `npm_downloads:${pkg}`, label: `npm downloads: ${pkg}`, unit: 'downloads', kind: 'weekly_total' as const, sourceUrl: `https://api.npmjs.org/downloads/range/{start}:{end}/${pkg}` })),
    ...(company?.pypiPackages ?? []).map(pkg => ({ id: `pypi_downloads:${pkg}`, label: `PyPI downloads: ${pkg}`, unit: 'downloads', kind: 'weekly_total' as const, sourceUrl: `https://pypistats.org/packages/${pkg}` })),
  ];
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, 'Enter a real calendar date');
export const intakeObservationSchema = z.object({
  metricId: z.string().min(1).max(200),
  value: z.number().finite().min(0).max(1e15),
  periodStart: day,
  periodEnd: day,
  simulated: z.boolean().default(false),
  note: z.string().trim().max(500).default(''),
}).strict().refine(v => v.periodStart <= v.periodEnd, 'Period start must not follow its end');
export const intakeQuestionSchema = z.object({
  metricId: z.string().min(1).max(200),
  threshold: z.number().finite().positive().max(1e15),
  targetDate: day,
}).strict();
export const modelIntakeSchema = z.object({
  expectedVersion: z.number().int().positive(),
  question: intakeQuestionSchema,
  observations: z.array(intakeObservationSchema).max(100),
}).strict();
export type IntakeQuestion = z.infer<typeof intakeQuestionSchema>;
export type IntakeObservation = z.infer<typeof intakeObservationSchema>;
export type ModelIntake = z.infer<typeof modelIntakeSchema>;

export function questionTextFor(startup: string, metric: IntakeMetric, question: IntakeQuestion): string {
  const period = metric.kind === 'snapshot' ? `on ${question.targetDate}` : `in the 7 days ending ${question.targetDate}`;
  return `Will ${startup}'s ${metric.label} be at least ${question.threshold.toLocaleString('en-US', { maximumFractionDigits: 20 })} ${metric.unit} ${period}?`;
}

export function resolutionUrlFor(metric: IntakeMetric, question: IntakeQuestion): string | null {
  return metric.sourceUrl?.replace('{start}', addDays(question.targetDate, -6)).replace('{end}', question.targetDate) ?? null;
}
