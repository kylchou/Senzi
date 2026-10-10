// Recomputes the baseline for every question and stores a snapshot only when
// its inputs changed (new data). Prints a summary table and resolves questions
// whose window has been reported.
//
//   npx tsx lib/model/cli/refresh.ts

import { refreshBaseline } from '../index';
import { resolveQuestion } from '../questions';
import { FileModelStore } from '../store';

const store = new FileModelStore();
const now = new Date();
const pct = (x: number | null) => (x === null ? '  –  ' : `${(x * 100).toFixed(0).padStart(3)}%`);
const millions = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${(x / 1e6).toFixed(2)}M`);

for (const q of store.readQuestions()) {
  // Opening baseline: as of when the question opens (or now, if it hasn't opened yet).
  const asOf = new Date(Math.min(Date.parse(q.opensAt), now.getTime()));
  const { result, changed } = refreshBaseline(q.id, { store, asOf });
  const d = result.method.details;
  const resolution = resolveQuestion(q, store.readPoints(q.companyId), now);
  console.log(
    [
      q.id.padEnd(30),
      `p=${pct(result.probability)} [${pct(result.low)}–${pct(result.high)}]`,
      `conf=${(result.confidence ?? '–').padEnd(6)}`,
      `T=${millions(q.threshold)}`,
      `last=${millions(d.lastObservedWeek?.total)}`,
      `median=${millions(d.forecastMedian)}`,
      `80%=${d.forecastRange80 ? `${millions(d.forecastRange80[0])}–${millions(d.forecastRange80[1])}` : '–'}`,
      `growth/wk=${d.weeklyGrowth === null ? '–' : `${(d.weeklyGrowth * 100).toFixed(1)}%`}`,
      `h=${d.horizonWeeks}`,
      changed ? 'NEW' : 'unchanged',
      resolution.status === 'resolved' ? `RESOLVED ${resolution.outcome} (${millions(resolution.observedTotal)})` : '',
    ].join('  '),
  );
  for (const n of [...result.notes, ...result.missing]) console.log(`    - ${n}`);
}
