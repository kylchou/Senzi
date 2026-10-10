import type { LockManager } from '../ports.js';

/**
 * In-process keyed mutex. Stand-in for database row locks; only correct within
 * a single Node process.
 */
export class InProcessLockManager implements LockManager {
  private readonly tails = new Map<string, Promise<void>>();

  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    // Stable order across callers prevents deadlock.
    const ordered = [...new Set(keys)].sort();
    const releases: Array<() => void> = [];
    try {
      for (const key of ordered) releases.push(await this.acquire(key));
      return await fn();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}
