import { z } from "zod";
import type { ApiErrorCode } from "@/lib/types";

/**
 * Browser client for the forecast and account APIs. The server is
 * authoritative for balances, receipts, and settlement; nothing here
 * calculates them. Responses use the shared envelope from docs/API.md:
 * `{ data }` on success and `{ error: { code, message } }` on failure.
 */

export const forecastSides = ["YES", "NO"] as const;
export type ForecastSide = (typeof forecastSides)[number];

/** Receipt from POST /api/forecasts (Engineer 2). Optional fields render when present. */
export const receiptSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  side: z.enum(forecastSides),
  credits: z.number(),
  createdAt: z.string(),
  /** YES allocation share at entry, if the server returns it. */
  entryAllocationShare: z.number().min(0).max(1).nullable().optional(),
  /** Balance after the stake. Null or absent when the server does not report it. */
  balanceAfter: z.number().nullable().optional(),
  /** General Users estimate (all forecasters) just after this forecast, from the pricing rule. */
  priceAfter: z.number().min(0).max(1).nullable().optional(),
});
export type ForecastReceiptData = z.infer<typeof receiptSchema>;

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string().optional() }) });

export type ForecastErrorCode = ApiErrorCode | "NETWORK" | "UNKNOWN";

export class ForecastError extends Error {
  constructor(
    public code: ForecastErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const knownCodes = new Set<string>([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "INSUFFICIENT_CREDITS",
  "INVALID_STATE",
  "INTERNAL_ERROR",
]);

async function toError(response: Response): Promise<ForecastError> {
  const body = errorSchema.safeParse(await response.json().catch(() => null));
  const message = body.success ? (body.data.error.message ?? "") : "";
  if (response.status === 401) return new ForecastError("UNAUTHENTICATED", message);
  const code = body.success && knownCodes.has(body.data.error.code) ? (body.data.error.code as ApiErrorCode) : "UNKNOWN";
  return new ForecastError(code, message);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ForecastError("NETWORK", "");
  }
}

export interface TraderAccount {
  balance: number;
  /** Null until they finish onboarding. VC accounts can't trade. */
  accountType: "VC" | "TRADER" | null;
}

/** Balance and account type from GET /api/users/me. Throws UNAUTHENTICATED when signed out. */
export async function fetchAccount(signal?: AbortSignal): Promise<TraderAccount> {
  const response = await request("/api/users/me", { signal });
  if (!response.ok) throw await toError(response);
  const body = z
    .object({ data: z.object({ creditBalance: z.number(), accountType: z.enum(["VC", "TRADER"]).nullish() }) })
    .safeParse(await response.json().catch(() => null));
  if (!body.success) throw new ForecastError("UNKNOWN", "");
  return { balance: body.data.data.creditBalance, accountType: body.data.data.accountType ?? null };
}

/** Current balance from GET /api/users/me. Throws UNAUTHENTICATED when signed out. */
export async function fetchBalance(signal?: AbortSignal): Promise<number> {
  return (await fetchAccount(signal)).balance;
}

/** Body matches forecastSubmissionSchema in lib/validation.ts. */
export async function submitForecast(input: {
  marketId: string;
  side: ForecastSide;
  credits: number;
  idempotencyKey: string;
}): Promise<ForecastReceiptData> {
  const response = await request("/api/forecasts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await toError(response);
  const body = z.object({ data: receiptSchema }).safeParse(await response.json().catch(() => null));
  if (!body.success) throw new ForecastError("UNKNOWN", "");
  return body.data.data;
}

export function errorMessage(error: ForecastError): string {
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "Your session expired. Sign in to continue.";
    case "INSUFFICIENT_CREDITS":
      return "Not enough credits for this allocation.";
    case "INVALID_STATE":
      return "This market is closed to new forecasts.";
    case "NOT_FOUND":
      return "This market is no longer available.";
    case "CONFLICT":
      return "This forecast was already recorded.";
    case "VALIDATION_ERROR":
      return error.message || "Check your allocation and try again.";
    case "FORBIDDEN":
      return "You cannot forecast on this market.";
    case "NETWORK":
      return "Connection lost. Try again.";
    default:
      return "Could not submit. Try again.";
  }
}

/** Client-side check before sending. The server still validates everything. */
export function validateCredits(raw: string, balance: number | null): string | null {
  if (raw.trim() === "") return "Enter an amount.";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return "Use a whole number of at least 1.";
  if (balance !== null && value > balance) return "Not enough credits for this allocation.";
  return null;
}
