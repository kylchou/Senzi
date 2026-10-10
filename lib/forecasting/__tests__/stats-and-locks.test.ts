import { describe, expect, it } from 'vitest';
import { InProcessLockManager } from '../index';
import { brierScore, calibrationBins, expectedCalibrationError, wilsonInterval } from '../stats';

describe('stats', () => {
  it('computes Wilson intervals', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const [lo, hi] = wilsonInterval(5, 10)!;
    expect(lo).toBeCloseTo(0.2366, 3);
    expect(hi).toBeCloseTo(0.7634, 3);
    const [lo0, hi0] = wilsonInterval(0, 10)!;
    expect(lo0).toBe(0);
    expect(hi0).toBeCloseTo(0.2775, 3);
    expect(wilsonInterval(10, 10)![1]).toBe(1);
  });

  it('computes Brier scores', () => {
    expect(brierScore([])).toBeNull();
    expect(brierScore([{ predicted: 1, actual: 1 }, { predicted: 0, actual: 0 }])).toBe(0);
    expect(brierScore([{ predicted: 0.5, actual: 1 }])).toBe(0.25);
  });

  it('bins predictions, including exactly 0 and 1', () => {
    const bins = calibrationBins(
      [
        { predicted: 0, actual: 0 },
        { predicted: 0.1, actual: 0 },
        { predicted: 1, actual: 1 },
      ],
      10,
    );
    expect(bins).toHaveLength(10);
    expect(bins[0]!.count).toBe(1);
    expect(bins[1]!.count).toBe(1);
    expect(bins[9]!.count).toBe(1);
    expect(bins[5]).toMatchObject({ count: 0, meanPredicted: null, observedRate: null, interval: null });
    expect(expectedCalibrationError(bins)).toBeCloseTo(0.1 / 3);
    expect(expectedCalibrationError(calibrationBins([], 10))).toBeNull();
  });
});

describe('InProcessLockManager', () => {
  const tick = () => new Promise((r) => setTimeout(r, 1));

  it('serializes work on the same key', async () => {
    const locks = new InProcessLockManager();
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        locks.withLocks(['k'], async () => {
          maxInside = Math.max(maxInside, ++inside);
          await tick();
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
  });

  it('runs different keys in parallel', async () => {
    const locks = new InProcessLockManager();
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      ['a', 'b', 'c'].map((k) =>
        locks.withLocks([k], async () => {
          maxInside = Math.max(maxInside, ++inside);
          await tick();
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(3);
  });

  it('does not deadlock when callers list keys in opposite orders', async () => {
    const locks = new InProcessLockManager();
    const order: string[] = [];
    await Promise.all([
      locks.withLocks(['x', 'y'], async () => {
        await tick();
        order.push('xy');
      }),
      locks.withLocks(['y', 'x'], async () => {
        await tick();
        order.push('yx');
      }),
    ]);
    expect(order).toHaveLength(2);
  });

  it('releases locks when work throws', async () => {
    const locks = new InProcessLockManager();
    await expect(locks.withLocks(['k'], async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(locks.withLocks(['k'], async () => 'ok')).resolves.toBe('ok');
  });
});
