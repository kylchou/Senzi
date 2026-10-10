// Who may forecast on a market. Rules come from the spec's "Who can do what":
// sponsors can't trade on their own questions, and employees, advisors and
// investors can't trade on their company.

import type { EngineConfig } from './config';
import type { TraderDirectory } from './ports';
import type { Market } from './types';

export type IneligibleReason = 'SPONSOR_OF_MARKET' | 'CONFLICT_OF_INTEREST' | 'NOT_VERIFIED';

export interface EligibilityDecision {
  eligible: boolean;
  reason?: IneligibleReason;
  /** Verified user of the company's product. Decides whether the forecast counts toward the specialized line. */
  verified: boolean;
}

export async function checkEligibility(
  market: Market,
  userId: string,
  traders: TraderDirectory,
  config: EngineConfig,
): Promise<EligibilityDecision> {
  const [verified, conflicted] = await Promise.all([
    traders.isVerifiedUserOf(userId, market.companyId),
    traders.hasConflictOfInterest(userId, market.companyId),
  ]);
  if (userId === market.sponsorId) return { eligible: false, reason: 'SPONSOR_OF_MARKET', verified };
  if (conflicted) return { eligible: false, reason: 'CONFLICT_OF_INTEREST', verified };
  if ((config.requireVerifiedTrader || market.verifiedUsersOnly) && !verified) {
    return { eligible: false, reason: 'NOT_VERIFIED', verified };
  }
  return { eligible: true, verified };
}
