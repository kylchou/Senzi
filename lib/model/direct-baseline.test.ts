import { describe, expect, it } from 'vitest';
import { computeDirectBaseline } from './direct-baseline';
import { KPI_METRICS, intakeMetrics, modelIntakeSchema } from './intake';
import type { DataPoint } from './types';
import { baselineMethodology, verifyStudyBaseline } from './study-baseline';
import { questionTextFor } from './intake';

const now = new Date('2026-10-09T12:00:00Z');
const metric = KPI_METRICS[0];
const question = { metricId: metric.id, threshold: 1600, targetDate: '2026-11-01' };
function point(date: string, value: number, overrides: Partial<DataPoint> = {}): DataPoint {
  return { companyId: 'company', metricId: metric.id, value, source: 'sponsor', periodStart: date, periodEnd: date, availableAt: '2026-10-08T00:00:00Z', fetchedAt: '2026-10-08T00:00:00Z', sourceUrl: 'sponsor-entry', provenance: 'sponsor_provided', simulated: false, ...overrides };
}
const history = () => [point('2026-07-01',1000), point('2026-08-01',1200), point('2026-09-01',1400)];
describe('direct metric baseline', () => {
  it('forecasts from sponsor-only history and responds to relevant changes', () => {
    const first = computeDirectBaseline('company', question, metric, history(), now);
    const larger = computeDirectBaseline('company', question, metric, history().map(p => ({ ...p, value: p.value*2 })), now);
    expect(first.status).toBe('ok');
    expect(larger.probability!).toBeGreaterThan(first.probability!);
    expect(first.inputsUsed).toHaveLength(3);
  });
  it('never sums snapshot values into weekly totals', () => {
    const result = computeDirectBaseline('company', question, metric, history().map(p => ({ ...p, value: 1000 })), now);
    expect(result.forecastMedian).toBeCloseTo(1000, 6);
  });
  it('excludes unrelated metrics and other startups without changing the probability or fingerprint', () => {
    const first = computeDirectBaseline('company', question, metric, history(), now);
    const other = computeDirectBaseline('company', question, metric, [...history(), point('2026-09-20',1e9,{metricId:'sponsor_mrr'}), point('2026-09-21',1e9,{companyId:'another'})], now);
    expect(other.probability).toBe(first.probability);
    expect(other.inputsHash).toBe(first.inputsHash);
    expect(other.excluded).toContainEqual({metricId:'sponsor_mrr',reason:expect.stringContaining('does not match')});
  });
  it('excludes future availability and future observation periods', () => {
    const base = computeDirectBaseline('company', question, metric, history(), now);
    const result = computeDirectBaseline('company', question, metric, [...history(), point('2026-09-20',1e9,{availableAt:'2026-10-10T00:00:00Z'}), point('2026-10-10',1e9)], now);
    expect(result.probability).toBe(base.probability);
    expect(result.excluded).toHaveLength(2);
  });
  it('requires enough distinct history rather than forcing a probability', () => {
    expect(computeDirectBaseline('company',question,metric,history().slice(0,1),now).probability).toBeNull();
    expect(computeDirectBaseline('company',question,metric,[point('2026-10-01',1),point('2026-10-02',2),point('2026-10-03',3)],now).probability).toBeNull();
  });
  it('reproduces identical results from the saved evidence', () => {
    expect(computeDirectBaseline('company',question,metric,history(),now)).toEqual(computeDirectBaseline('company',question,metric,history(),now));
  });
  it('preserves fingerprint and probability after JSONB reorders object keys', () => {
    const reorder = <T extends object>(value:T):T => Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) as T;
    const before = computeDirectBaseline('company',question,metric,history(),now);
    const after = computeDirectBaseline('company',reorder(question),metric,history().map(reorder),now);
    expect(after.inputsHash).toBe(before.inputsHash);
    expect(after.probability).toBe(before.probability);
    expect(after.low).toBe(before.low);
    expect(after.high).toBe(before.high);
  });
  it('supports sponsor-only seven-day totals', () => {
    const download = intakeMetrics({slug:'supabase',name:'Supabase'}).find(m => m.id.startsWith('npm_'))!;
    const rows = [['2026-09-21','2026-09-27'],['2026-09-14','2026-09-20'],['2026-09-07','2026-09-13']].map(([start,end]) => point(end,1000,{metricId:download.id,periodStart:start}));
    const result = computeDirectBaseline('company',{metricId:download.id,threshold:1100,targetDate:'2026-11-01'},download,rows,now);
    expect(result.status).toBe('ok');
    expect(result.forecastMedian).toBeCloseTo(1000);
  });
  it('prefers third-party observations for overlapping snapshots', () => {
    const rows = history();
    const result = computeDirectBaseline('company',question,metric,[...rows,point('2026-09-01',900,{source:'github',provenance:'scraped'})],now);
    expect(result.inputsUsed.find(p=>p.periodEnd==='2026-09-01')?.value).toBe(900);
  });
  it('rejects impossible calendar dates and forged provenance fields at intake', () => {
    expect(modelIntakeSchema.safeParse({expectedVersion:1,question:{...question,targetDate:'2026-02-30'},observations:[]}).success).toBe(false);
    expect(modelIntakeSchema.safeParse({expectedVersion:1,question,observations:[{metricId:metric.id,value:1,periodStart:'2026-01-01',periodEnd:'2026-01-01',provenance:'scraped'}]}).success).toBe(false);
  });
  it('verifies opening from frozen evidence and rejects a tampered probability', () => {
    const startup = { id:'company',slug:'acme',name:'Acme' };
    const result = computeDirectBaseline('company',question,metric,history(),now);
    const record = { question, inputSnapshot:history(), result, calculatedAt:now };
    const study = { question:questionTextFor(startup.name,metric,question),deadline:new Date('2026-10-20'),baselineValue:result.probability,baselineMethodology:baselineMethodology(result) };
    expect(verifyStudyBaseline(record,startup,study).result.probability).toBe(result.probability);
    expect(()=>verifyStudyBaseline(record,startup,{...study,baselineValue:0.9})).toThrow('no longer matches');
    expect(()=>verifyStudyBaseline({...record,result:null},startup,study)).toThrow('Recalculate');
    expect(()=>verifyStudyBaseline(record,startup,{...study,question:'A different question?'})).toThrow('no longer matches');
  });
  it('uses public totals over conflicting sponsor totals without changing the forecast', () => {
    const download = intakeMetrics({slug:'supabase',name:'Supabase'}).find(m => m.id.startsWith('npm_'))!;
    const rows: DataPoint[] = Array.from({length:28},(_,i)=> {
      const date = new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10);
      return point(date,100,{metricId:download.id,source:'npm',provenance:'scraped'});
    });
    const q = {metricId:download.id,threshold:900,targetDate:'2026-11-01'};
    const baseline = computeDirectBaseline('company',q,download,rows,now);
    const amended = computeDirectBaseline('company',q,download,[...rows,point('2026-09-27',100000,{metricId:download.id,periodStart:'2026-09-21'})],now);
    expect(amended.probability).toBe(baseline.probability);
    expect(amended.notes.some(n=>n.includes('sponsor value differs'))).toBe(true);
    expect(amended.inputsUsed.every(p=>p.provenance==='scraped')).toBe(true);
  });
});
