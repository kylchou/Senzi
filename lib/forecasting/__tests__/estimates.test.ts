import { describe, expect, it } from 'vitest';
import { defaultConfig, type CommunityEstimateRule } from '../index.js';
import {
  computeWithRule,
  confidenceFor,
  evidenceSupportsCalibratedLabel,
  formatPercent,
  labelFor,
  type CalibrationEvidence,
} from '../estimates.js';
import { DAY, expectCode, modelService, setup, T0 } from './helpers.js';

const goodEvidence: CalibrationEvidence = {
  line: 'general',
  estimateRuleId: 'test-count-share',
  resolvedMarkets: 40,
  expectedCalibrationError: 0.02,
  sufficient: true,
};

describe('labels', () => {
  it('never calls an allocation share a probability, and never tags a market price calibrated without evidence', () => {
    for (const line of ['general', 'specialized'] as const) {
      expect(labelFor('allocation_share', line, false).toLowerCase()).not.toContain('probability');
      expect(labelFor(null, line, false).toLowerCase()).not.toContain('probability');
      expect(labelFor('market_price', line, false).toLowerCase()).not.toContain('calibrated');
    }
    expect(labelFor('market_price', 'general', false)).toBe('Market probability (all users)');
    expect(labelFor('market_price', 'specialized', false)).toBe('Market probability (verified users)');
  });

  it('allows the calibrated label only with sufficient evidence for the same line and rule', () => {
    const c = defaultConfig;
    expect(evidenceSupportsCalibratedLabel(goodEvidence, 'general', 'test-count-share', c)).toBe(true);
    expect(evidenceSupportsCalibratedLabel(undefined, 'general', 'test-count-share', c)).toBe(false);
    expect(evidenceSupportsCalibratedLabel(goodEvidence, 'specialized', 'test-count-share', c)).toBe(false);
    expect(evidenceSupportsCalibratedLabel(goodEvidence, 'general', 'other-rule', c)).toBe(false);
    expect(evidenceSupportsCalibratedLabel({ ...goodEvidence, sufficient: false }, 'general', 'test-count-share', c)).toBe(false);
    expect(evidenceSupportsCalibratedLabel({ ...goodEvidence, resolvedMarkets: 29 }, 'general', 'test-count-share', c)).toBe(false);
    expect(evidenceSupportsCalibratedLabel({ ...goodEvidence, expectedCalibrationError: 0.051 }, 'general', 'test-count-share', c)).toBe(false);
    expect(labelFor('allocation_share', 'general', true, goodEvidence)).toBe(
      'Community probability, all users (calibrated on 40 resolved markets)',
    );
    expect(labelFor('market_price', 'general', true, goodEvidence)).toBe(
      'Market probability (all users) · calibrated on 40 resolved markets',
    );
  });
});

describe('formatting and confidence', () => {
  it('formats percentages with edge cases', () => {
    expect(formatPercent(null)).toBeNull();
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.004)).toBe('<1%');
    expect(formatPercent(0.996)).toBe('>99%');
    expect(formatPercent(0.625)).toBe('63%');
  });

  it('maps forecaster counts to confidence labels', () => {
    expect(confidenceFor(0, defaultConfig)).toBe('none');
    expect(confidenceFor(1, defaultConfig)).toBe('low');
    expect(confidenceFor(9, defaultConfig)).toBe('low');
    expect(confidenceFor(10, defaultConfig)).toBe('medium');
    expect(confidenceFor(30, defaultConfig)).toBe('high');
  });
});

describe('rule output guard', () => {
  it.each([1.2, -0.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s from a rule', (bad) => {
    const rule: CommunityEstimateRule = { id: 'bad', kind: 'allocation_share', compute: () => bad };
    expect(() => computeWithRule(rule, 0.5, [])).toThrow(/returned/);
  });
});

describe('getMarketEstimates', () => {
  it('handles an empty market: baseline shown, community lines empty with a reason', async () => {
    const t = setup();
    const m = await t.createMarket();
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.openingBaseline).toMatchObject({ value: 0.4, display: '40%', label: 'Model baseline (at open)' });
    expect(e.model).toMatchObject({ value: 0.4, label: 'Model baseline' });
    expect(e.general).toMatchObject({
      value: null,
      display: null,
      forecasterCount: 0,
      confidence: 'none',
      emptyReason: 'No forecasts yet',
      isCalibratedProbability: false,
    });
    expect(e.specialized.emptyReason).toBe('No forecasts from verified users yet');
  });

  it('handles a market with no model value yet', async () => {
    const t = setup();
    const m = await t.createMarket({ openingBaseline: null, model: null });
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.openingBaseline.value).toBeNull();
    expect(e.openingBaseline.emptyReason).toMatch(/not produced/);
  });

  it('still returns the model line when no pricing rule is configured', async () => {
    const t = setup({ estimateRule: undefined });
    const m = await t.createMarket();
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.model.value).toBe(0.4);
    expect(e.general.kind).toBeNull();
    expect(e.general.emptyReason).toBe('No pricing rule configured yet');
  });

  it('keeps the baseline separate from the community estimate', async () => {
    const t = setup();
    const m = await t.createMarket();
    for (const u of ['a', 'b', 'c']) {
      await t.fund(u);
      await t.forecast(u, m.id, 'YES');
    }
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.general.value).toBe(1);
    expect(e.openingBaseline.value).toBe(0.4);
    expect(e.model.value).toBe(0.4);
    expect(e.general.label).toBe('YES allocation share, all users');
    expect(e.general).toMatchObject({ forecasterCount: 3, forecastCount: 3, totalAmount: 30, confidence: 'low' });
  });

  it('counts distinct forecasters, not forecasts, for confidence', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('a');
    for (let i = 0; i < 12; i++) await t.forecast('a', m.id, 'YES');
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.general.forecasterCount).toBe(1);
    expect(e.general.forecastCount).toBe(12);
    expect(e.general.confidence).toBe('low');
  });

  it('builds the specialized line from verified forecasts only', async () => {
    const t = setup();
    const m = await t.createMarket();
    t.traders.verify('v1', 'acme');
    t.traders.verify('v2', 'other-co'); // verified for a different company: doesn't count
    for (const u of ['v1', 'v2', 'g1']) await t.fund(u);
    await t.forecast('v1', m.id, 'NO');
    await t.forecast('v2', m.id, 'YES');
    await t.forecast('g1', m.id, 'YES');
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.general.value).toBeCloseTo(2 / 3);
    expect(e.specialized.value).toBe(0);
    expect(e.specialized.forecasterCount).toBe(1);
    expect(e.specialized.label).toBe('YES allocation share, verified users');
  });

  it('rejects unknown markets', async () => {
    const t = setup();
    await expectCode(t.engine.getMarketEstimates('missing'), 'MARKET_NOT_FOUND');
  });
});

describe('recordModelValue', () => {
  it('only accepts values from the model service', async () => {
    const t = setup();
    const m = await t.createMarket();
    const v = { value: 0.6, asOf: T0, modelVersion: 'v1' };
    await expectCode(t.engine.recordModelValue({ kind: 'user', userId: 'vc' }, m.id, v), 'FORBIDDEN');
    await expectCode(t.engine.recordModelValue({ kind: 'service', serviceId: 'other' }, m.id, v), 'FORBIDDEN');
  });

  it('moves the opening baseline only until the first forecast', async () => {
    const t = setup();
    const m = await t.createMarket({ openingBaseline: null, model: null });
    const r1 = await t.engine.recordModelValue(modelService, m.id, { value: 0.3, asOf: T0, modelVersion: 'v1' });
    expect(r1.openingBaselineUpdated).toBe(true);

    await t.fund('a');
    await t.forecast('a', m.id, 'YES');

    const later = new Date(T0.getTime() + DAY);
    const r2 = await t.engine.recordModelValue(modelService, m.id, { value: 0.7, asOf: later, modelVersion: 'v2' });
    expect(r2.openingBaselineUpdated).toBe(false);
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.openingBaseline).toMatchObject({ value: 0.3, modelVersion: 'v1' });
    expect(e.model).toMatchObject({ value: 0.7, modelVersion: 'v2' });
    expect(e.general.value).toBe(1); // forecasts unaffected by the model update

    const snaps = await t.repo.listSnapshots(m.id);
    expect(snaps.map((s) => [s.trigger, s.model, s.openingBaseline])).toEqual([
      ['model_update', 0.3, 0.3],
      ['forecast', 0.3, 0.3],
      ['model_update', 0.7, 0.3],
    ]);
  });

  it('rejects stale and invalid values', async () => {
    const t = setup();
    const m = await t.createMarket();
    const older = new Date(T0.getTime() - DAY);
    await expectCode(t.engine.recordModelValue(modelService, m.id, { value: 0.5, asOf: older, modelVersion: 'v' }), 'VALIDATION_FAILED');
    await expectCode(t.engine.recordModelValue(modelService, m.id, { value: 1.5, asOf: T0, modelVersion: 'v' }), 'VALIDATION_FAILED');
    await expectCode(t.engine.recordModelValue(modelService, m.id, { value: 0.5, asOf: new Date('x'), modelVersion: 'v' }), 'VALIDATION_FAILED');
    await expectCode(t.engine.recordModelValue(modelService, m.id, { value: 0.5, asOf: T0, modelVersion: ' ' }), 'VALIDATION_FAILED');
  });

  it('refuses updates on resolved markets', async () => {
    const t = setup();
    const m = await t.createMarket({ status: 'resolved' });
    await expectCode(t.engine.recordModelValue(modelService, m.id, { value: 0.5, asOf: T0, modelVersion: 'v' }), 'MARKET_NOT_OPEN');
  });
});

