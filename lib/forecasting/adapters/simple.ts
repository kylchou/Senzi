import { randomUUID } from 'node:crypto';
import type { AuthContext, Clock, IdGenerator, SettlementAuthorizer, TraderDirectory } from '../ports.js';

export const systemClock: Clock = { now: () => new Date() };

export const uuidIds: IdGenerator = { next: (prefix) => `${prefix}_${randomUUID()}` };

/** Fixed clock for tests; advance it manually. */
export class ManualClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(at: Date) {
    this.current = new Date(at);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Verification lookups from fixed lists. Stand-in for the verification service
 * (which the demo mocks with an admin approve button).
 */
export class StaticTraderDirectory implements TraderDirectory {
  private readonly verified = new Set<string>();
  private readonly conflicts = new Set<string>();

  constructor(init: { verified?: Array<[userId: string, companyId: string]>; conflicts?: Array<[string, string]> } = {}) {
    for (const [u, c] of init.verified ?? []) this.verify(u, c);
    for (const [u, c] of init.conflicts ?? []) this.declareConflict(u, c);
  }

  verify(userId: string, companyId: string) {
    this.verified.add(`${userId}|${companyId}`);
  }

  declareConflict(userId: string, companyId: string) {
    this.conflicts.add(`${userId}|${companyId}`);
  }

  async isVerifiedUserOf(userId: string, companyId: string) {
    return this.verified.has(`${userId}|${companyId}`);
  }

  async hasConflictOfInterest(userId: string, companyId: string) {
    return this.conflicts.has(`${userId}|${companyId}`);
  }
}

/** Authorizes a fixed set of service ids as the resolution workflow. */
export class AllowListSettlementAuthorizer implements SettlementAuthorizer {
  constructor(private readonly serviceIds: readonly string[]) {}
  isAuthorizedResolutionCaller(auth: AuthContext) {
    return auth.kind === 'service' && this.serviceIds.includes(auth.serviceId);
  }
}
