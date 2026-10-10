import { ApiError } from "@/lib/api-response";
import type { ApiErrorCode, ValidationIssue } from "@/lib/types";

/** The shared API error codes (lib/types.ts), so VC routes answer like every other route. */
export type VcErrorCode = ApiErrorCode;

export class VcError extends ApiError {
  constructor(code: VcErrorCode, message: string, details?: ValidationIssue[] | Record<string, unknown>) {
    super(code, message, details);
    this.name = "VcError";
  }

  get httpStatus(): number {
    return this.status;
  }
}

export const isVcError = (err: unknown): err is ApiError => err instanceof ApiError;

/**
 * Private resources the caller cannot see are reported as NOT_FOUND so that
 * their existence is not leaked across organizations.
 */
export const notFound = (what = "Resource") => new VcError("NOT_FOUND", `${what} not found`);
export const forbidden = (message = "You do not have permission to perform this action") =>
  new VcError("FORBIDDEN", message);
