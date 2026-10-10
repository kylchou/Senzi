/**
 * Route handler helpers for app/api/studies/** and app/api/vc/**.
 *
 * Response envelope:
 *   success: { "data": ... }
 *   error:   { "error": { "code": ApiErrorCode, "message": string, "details"?: unknown } }
 * Errors are formatted by the shared errorResponse in lib/api-response.ts.
 */
import { timingSafeEqual } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { errorResponse as sharedErrorResponse } from "@/lib/api-response";
import { VcError } from "../errors";
import type { VcServices } from "../services";
import type { VcContext } from "../types";
import { formatIssues } from "../validation";
import { getVcServices } from "./container";
import { requireVcContext } from "./context";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export function ok(data: unknown, init: { status?: number } = {}) {
  return NextResponse.json({ data }, { status: init.status ?? 200, headers: PRIVATE_HEADERS });
}

export function errorResponse(err: unknown) {
  // Let Next.js handle its own control-flow errors (e.g. prerender bail-outs).
  unstable_rethrow(err);
  const res = sharedErrorResponse(err);
  res.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  return res;
}

export function parseWith<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new VcError("VALIDATION_ERROR", "Invalid request", formatIssues(result.error));
  return result.data;
}

export async function parseBody<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new VcError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
  return parseWith(schema, body);
}

export function parseQuery<T extends z.ZodTypeAny>(req: NextRequest, schema: T): z.infer<T> {
  return parseWith(schema, Object.fromEntries(req.nextUrl.searchParams));
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rejects cross-site state-changing requests (cookie-authenticated API). */
function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    throw new VcError("FORBIDDEN", "Cross-origin request rejected");
  }
}

interface HandlerArgs<P> {
  req: NextRequest;
  params: P;
  ctx: VcContext;
  services: VcServices;
}

/**
 * Wraps a handler with authentication, active-org resolution (`?orgId=` or
 * `x-vc-org-id`, falling back to the org cookie), CSRF origin checks and error mapping.
 */
export function withVc<P = Record<string, never>>(handler: (args: HandlerArgs<P>) => Promise<Response>) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const orgId = req.nextUrl.searchParams.get("orgId") ?? req.headers.get("x-vc-org-id");
      const ctx = await requireVcContext(orgId);
      const params = segment?.params ? await segment.params : ({} as P);
      return await handler({ req, params, ctx, services: getVcServices() });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Constant-time bearer check for scheduled jobs (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
