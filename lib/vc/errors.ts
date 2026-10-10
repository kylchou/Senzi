export type VcErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "UPSTREAM";

const STATUS_BY_CODE: Record<VcErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  UPSTREAM: 502,
};

export class VcError extends Error {
  readonly code: VcErrorCode;
  readonly details?: unknown;

  constructor(code: VcErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "VcError";
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return STATUS_BY_CODE[this.code];
  }
}

export const isVcError = (err: unknown): err is VcError => err instanceof VcError;

/**
 * Private resources the caller cannot see are reported as NOT_FOUND so that
 * their existence is not leaked across organizations.
 */
export const notFound = (what = "Resource") => new VcError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new VcError("FORBIDDEN", message);
