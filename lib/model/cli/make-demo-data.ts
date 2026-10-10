// Writes the demo questions and the SIMULATED sponsor metrics.
//
//   npx tsx lib/model/cli/make-demo-data.ts
//
// Questions: one open question per company on its question metric, plus one
// past question that has already resolved from real data. Thresholds are round
// numbers a sponsor might pick near the latest week; they are not tuned to the
// model's output.
//
// Sponsor metrics: ARR, MRR and user counts are SIMULATED placeholders, not
// real company data, and are labeled that way. No demo question uses a sponsor
// metric, so no baseline depends on them.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANIES } from '../catalog';
import { addDays } from '../dates';
import { makeQuestion } from '../questions';
import { sponsorPoint } from '../sponsor';
import { DEFAULT_DATA_DIR } from '../store';

const OPENS_AT = '2026-10-10T00:00:00.000Z';
const WINDOW_END = '2026-11-08';

const thresholds: Record<string, number> = {
  supabase: 35_000_000,
  vercel: 5_000_000,
  stripe: 25_000_000,
  resend: 16_000_000,
  convex: 2_000_000,
  posthog: 17_000_000,
};

const questions = COMPANIES.map((c) =>
  makeQuestion({
    id: `q-${c.id}-${WINDOW_END}`,
    companyId: c.id,
    metricId: c.questionMetricId,
    threshold: thresholds[c.id]!,
    windowEnd: WINDOW_END,
    opensAt: OPENS_AT,
  }),
);

// Past question: opened 2026-09-06, window ended 2026-10-04. Resolves from real npm data.
questions.push(
  makeQuestion({
    id: 'q-supabase-2026-10-04-past',
    companyId: 'supabase',
    metricId: 'npm_downloads:@supabase/supabase-js',
    threshold: 27_500_000,
    windowEnd: '2026-10-04',
    opensAt: '2026-09-06T00:00:00.000Z',
    note: 'Demo of a past question resolved live from real data. Baseline computed as of opensAt.',
  }),
);

mkdirSync(DEFAULT_DATA_DIR, { recursive: true });
writeFileSync(join(DEFAULT_DATA_DIR, 'questions.json'), JSON.stringify(questions, null, 2) + '\n');

// SIMULATED sponsor KPIs: three monthly values per company with placeholder levels.
const NOTE = 'SIMULATED for the demo. Placeholder value, not real company data.';
mkdirSync(join(DEFAULT_DATA_DIR, 'sponsor'), { recursive: true });
COMPANIES.forEach((c, i) => {
  const months = ['2026-07-31', '2026-08-31', '2026-09-30'];
  const points = months.flatMap((end, m) => {
    const growth = 1 + 0.04 * m;
    const start = addDays(end, -29);
    const entered = `${addDays(end, 5)}T00:00:00.000Z`;
    const entry = (metric: 'arr' | 'mrr' | 'users', value: number) =>
      sponsorPoint({ companyId: c.id, metric, value: Math.round(value), periodStart: start, periodEnd: end, enteredAt: entered, simulated: true, note: NOTE });
    const arr = 10_000_000 * (i + 1) * growth;
    return [entry('arr', arr), entry('mrr', arr / 12), entry('users', 50_000 * (i + 1) * growth)];
  });
  writeFileSync(join(DEFAULT_DATA_DIR, 'sponsor', `${c.id}.json`), JSON.stringify(points, null, 2) + '\n');
});

console.log(`Wrote ${questions.length} questions and simulated sponsor metrics for ${COMPANIES.length} companies.`);
