// File-backed storage under data/model/, used until Engineer 1 adds the tables
// proposed in docs/model-schema-proposal.md.
//
//   points/<companyId>.jsonl     scraped data points
//   sponsor/<companyId>.json     sponsor-provided points (simulated in the demo)
//   questions.json               threshold questions
//   baselines.jsonl              baseline snapshots, appended only when inputs change

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BaselineResult, DataPoint, ThresholdQuestion } from './types.js';

export interface ModelStore {
  readPoints(companyId?: string): DataPoint[];
  readSponsorPoints(companyId?: string): DataPoint[];
  readQuestions(): ThresholdQuestion[];
  readBaselineSnapshots(): BaselineResult[];
  appendBaselineSnapshot(result: BaselineResult): void;
}

export const DEFAULT_DATA_DIR = join(process.cwd(), 'data', 'model');

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export class FileModelStore implements ModelStore {
  constructor(readonly dir: string = DEFAULT_DATA_DIR) {}

  private companies(sub: string, ext: string): string[] {
    const d = join(this.dir, sub);
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((f) => f.endsWith(ext))
      .map((f) => f.slice(0, -ext.length));
  }

  readPoints(companyId?: string): DataPoint[] {
    const ids = companyId ? [companyId] : this.companies('points', '.jsonl');
    return ids.flatMap((id) => readJsonl<DataPoint>(join(this.dir, 'points', `${id}.jsonl`)));
  }

  writePoints(companyId: string, points: readonly DataPoint[]): void {
    const file = join(this.dir, 'points', `${companyId}.jsonl`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, points.map((p) => JSON.stringify(p)).join('\n') + (points.length ? '\n' : ''));
  }

  readSponsorPoints(companyId?: string): DataPoint[] {
    const ids = companyId ? [companyId] : this.companies('sponsor', '.json');
    return ids.flatMap((id) => {
      const file = join(this.dir, 'sponsor', `${id}.json`);
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DataPoint[]) : [];
    });
  }

  readQuestions(): ThresholdQuestion[] {
    const file = join(this.dir, 'questions.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ThresholdQuestion[]) : [];
  }

  readBaselineSnapshots(): BaselineResult[] {
    return readJsonl<BaselineResult>(join(this.dir, 'baselines.jsonl'));
  }

  appendBaselineSnapshot(result: BaselineResult): void {
    const file = join(this.dir, 'baselines.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(result) + '\n');
  }
}

/** In-memory store for tests. */
export class MemoryModelStore implements ModelStore {
  snapshots: BaselineResult[] = [];
  constructor(
    public points: DataPoint[] = [],
    public sponsor: DataPoint[] = [],
    public questions: ThresholdQuestion[] = [],
  ) {}
  readPoints(companyId?: string) {
    return this.points.filter((p) => !companyId || p.companyId === companyId);
  }
  readSponsorPoints(companyId?: string) {
    return this.sponsor.filter((p) => !companyId || p.companyId === companyId);
  }
  readQuestions() {
    return this.questions;
  }
  readBaselineSnapshots() {
    return this.snapshots;
  }
  appendBaselineSnapshot(r: BaselineResult) {
    this.snapshots.push(r);
  }
}
