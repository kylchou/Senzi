import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type {
  ApiErrorCode,
  ApiFailure,
  ApiSuccess,
  PageMeta,
  ValidationIssue,
} from "@/lib/types";

/**
 * Standard JSON envelope for every Senzi API route:
 *   success -> { data, meta? }
 *   failure -> { error: { code, message, details? } }
 */

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INSUFFICIENT_CREDITS: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Throw from any server code; route handlers turn it into a JSON response. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiFailure["error"]["details"];

  constructor(code: ApiErrorCode, message: string, details?: ApiFailure["error"]["details"]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const unauthenticated = (message = "Sign in required") =>
  new ApiError("UNAUTHENTICATED", message);
export const forbidden = (message = "You do not have permission to do that") =>
  new ApiError("FORBIDDEN", message);
export const notFound = (what = "Resource") => new ApiError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string) => new ApiError("CONFLICT", message);
export const invalidState = (message: string) => new ApiError("INVALID_STATE", message);

export function ok<T>(data: T, meta?: PageMeta, init?: ResponseInit) {
  const body: ApiSuccess<T> = meta ? { data, meta } : { data };
  return NextResponse.json(body, init);
}

export function created<T>(data: T) {
  return ok(data, undefined, { status: 201 });
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Converts any thrown value into an ApiError without leaking internals. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) {
    return new ApiError("VALIDATION_ERROR", "Invalid request", zodIssues(error));
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return conflict("A record with these values already exists");
      case "P2025":
        return notFound();
      case "P2003":
        return conflict("This record is still referenced by other data");
    }
  }
  return new ApiError("INTERNAL_ERROR", "Something went wrong");
}

export function errorResponse(error: unknown) {
  const apiError = toApiError(error);
  if (apiError.status >= 500) console.error("[api] unhandled error", error);
  const body: ApiFailure = {
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details ? { details: apiError.details } : {}),
    },
  };
  const retryAfter = (apiError.details as { retryAfter?: number } | undefined)?.retryAfter;
  return NextResponse.json(body, {
    status: apiError.status,
    ...(apiError.code === "RATE_LIMITED" && retryAfter ? { headers: { "Retry-After": String(retryAfter) } } : {}),
  });
}

/**
 * Wraps a route handler so thrown ApiErrors / ZodErrors / Prisma errors become
 * the standard error envelope.
 *
 *   export const GET = withApiHandler(async (req, ctx) => ok(await load()));
 */
export function withApiHandler<Ctx>(
  handler: (req: Request, ctx: Ctx) => Promise<Response>,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      // Let Next's own control-flow signals (redirects, prerender bailouts) through.
      unstable_rethrow(error);
      return errorResponse(error);
    }
  };
}

/** Parses and validates a JSON request body. */
export async function parseJsonBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

/** Parses and validates URL query parameters (single-valued). */
export function parseSearchParams<S extends z.ZodType>(req: Request, schema: S): z.output<S> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  return schema.parse(params);
}
