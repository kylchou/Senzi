// Typed errors. Each has a stable `code` so an API layer can map it to a status
// code without matching on messages.

export type ForecastingErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'MARKET_NOT_FOUND'
  | 'MARKET_NOT_OPEN'
  | 'MARKET_NOT_STARTED'
  | 'DEADLINE_PASSED'
  | 'NOT_ELIGIBLE'
  | 'INSUFFICIENT_BALANCE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'SETTLEMENT_CONFLICT'
  | 'SETTLEMENT_NOT_ALLOWED'
  | 'NOT_CONFIGURED'
  | 'INVARIANT_VIOLATION'
  /** The price moved more than the allowed tolerance since the client's quote. */
  | 'PRICE_MOVED';

export class ForecastingError extends Error {
  constructor(
    readonly code: ForecastingErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ForecastingError';
  }
}

export function isForecastingError(err: unknown, code?: ForecastingErrorCode): err is ForecastingError {
  return err instanceof ForecastingError && (code === undefined || err.code === code);
}

/** Thrown by CreditLedger.debit when the balance can't cover the amount. */
export class InsufficientBalanceError extends ForecastingError {
  constructor(userId: string, requested: number, available: number) {
    super('INSUFFICIENT_BALANCE', `Insufficient balance: requested ${requested}, available ${available}`, {
      userId,
      requested,
      available,
    });
    this.name = 'InsufficientBalanceError';
  }
}
