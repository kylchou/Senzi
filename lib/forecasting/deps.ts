import type { EngineConfig } from './config.js';
import { ForecastingError } from './errors.js';
import type {
  AuthContext,
  Clock,
  CommunityEstimateRule,
  CreditLedger,
  ForecastRepository,
  IdGenerator,
  LockManager,
  SettlementAuthorizer,
  SettlementModel,
  TraderDirectory,
} from './ports.js';

export interface EngineDeps {
  repo: ForecastRepository;
  ledger: CreditLedger;
  locks: LockManager;
  clock: Clock;
  ids: IdGenerator;
  traders: TraderDirectory;
  settlementAuthorizer: SettlementAuthorizer;
  /** Unset until the pricing decision is made; estimate and submit calls fail with NOT_CONFIGURED. */
  estimateRule?: CommunityEstimateRule;
  /** Unset until the settlement model is agreed; YES/NO settlement fails with NOT_CONFIGURED. */
  settlementModel?: SettlementModel;
  /** Service ids allowed to push model values (the model component). */
  modelServiceIds: readonly string[];
  config: EngineConfig;
}

export function requireRule(deps: EngineDeps): CommunityEstimateRule {
  if (!deps.estimateRule) {
    throw new ForecastingError(
      'NOT_CONFIGURED',
      'No community estimate rule configured. The pricing model (LMSR vs allocation share) is an open decision.',
    );
  }
  return deps.estimateRule;
}

export function requireSettlementModel(deps: EngineDeps): SettlementModel {
  if (!deps.settlementModel) {
    throw new ForecastingError(
      'NOT_CONFIGURED',
      'No settlement model configured. The virtual settlement model has not been agreed.',
    );
  }
  return deps.settlementModel;
}

export function requireUser(auth: AuthContext): string {
  if (auth.kind !== 'user' || typeof auth.userId !== 'string' || auth.userId === '') {
    throw new ForecastingError('UNAUTHENTICATED', 'Sign in to continue');
  }
  return auth.userId;
}

export const marketLockKey = (marketId: string) => `market:${marketId}`;
