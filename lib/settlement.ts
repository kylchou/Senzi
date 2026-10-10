import type { ResolutionOutcome } from "@/generated/prisma/enums";
import { SettlementStatus } from "@/generated/prisma/enums";
import { invalidState, notFound } from "@/lib/api-response";
import { db, type DbOrTx } from "@/lib/db";

/**
 * Runs settlement for approved resolutions and keeps its state consistent.
 *
 * This module owns the state machine (PENDING -> IN_PROGRESS -> COMPLETED or
 * FAILED, retryable). The forecasting engine owns the payout math: it provides
 * a SettleFn that pays every forecast through lib/credit-ledger.ts using
 * idempotency keys, so a retry after a crash never pays anyone twice.
 */

export interface SettleInput {
  resolutionId: string;
  marketId: string;
  outcome: ResolutionOutcome;
  resolvedAt: Date;
}

/** Returns the id of the settlement model used, for the record. */
export type SettleFn = (input: SettleInput) => Promise<{ settlementModelId?: string } | void>;

/**
 * The forecasting engine's settle function. Felix: replace null with it once
 * the engine has its database adapter. Until then resolutions stay PENDING.
 */
const forecastingSettle: SettleFn | null = null;

/** An IN_PROGRESS attempt older than this is assumed to have crashed. */
export const STALE_SETTLEMENT_MS = 10 * 60 * 1000;

export interface SettlementRun {
  resolutionId: string;
  status: SettlementStatus;
  /** False when nothing ran: not configured, already settled, or another worker has it. */
  ran: boolean;
  error?: string;
}

/**
 * Atomically takes a resolution for settlement: PENDING or FAILED, or an
 * IN_PROGRESS attempt that went stale. Returns false if someone else has it
 * or it's already done.
 */
export async function claimResolutionForSettlement(resolutionId: string, now = new Date()): Promise<boolean> {
  const { count } = await db.resolution.updateMany({
    where: {
      id: resolutionId,
      OR: [
        { settlementStatus: { in: [SettlementStatus.PENDING, SettlementStatus.FAILED] } },
        {
          settlementStatus: SettlementStatus.IN_PROGRESS,
          settlementStartedAt: { lt: new Date(now.getTime() - STALE_SETTLEMENT_MS) },
        },
      ],
    },
    data: {
      settlementStatus: SettlementStatus.IN_PROGRESS,
      settlementStartedAt: now,
      settlementError: null,
      settlementAttempts: { increment: 1 },
    },
  });
  return count === 1;
}

export async function completeResolutionSettlement(
  resolutionId: string,
  client: DbOrTx = db,
  settlementModelId?: string,
) {
  const { count } = await client.resolution.updateMany({
    where: { id: resolutionId, settlementStatus: SettlementStatus.IN_PROGRESS },
    data: {
      settlementStatus: SettlementStatus.COMPLETED,
      settledAt: new Date(),
      ...(settlementModelId ? { settlementModelId } : {}),
    },
  });
  if (count === 0) throw invalidState("Resolution is not being settled");
}

export async function failResolutionSettlement(resolutionId: string, message: string) {
  await db.resolution.updateMany({
    where: { id: resolutionId, settlementStatus: SettlementStatus.IN_PROGRESS },
    data: { settlementStatus: SettlementStatus.FAILED, settlementError: message.slice(0, 2000) },
  });
}

/**
 * Settles one resolution if it needs it. Never throws for settlement
 * failures: they're recorded as FAILED and can be retried.
 */
export async function runSettlement(
  resolutionId: string,
  settle: SettleFn | null = forecastingSettle,
): Promise<SettlementRun> {
  const resolution = await db.resolution.findUnique({
    where: { id: resolutionId },
    select: { id: true, marketId: true, outcome: true, resolvedAt: true, settlementStatus: true },
  });
  if (!resolution) throw notFound("Resolution");
  if (!settle) return { resolutionId, status: resolution.settlementStatus, ran: false, error: "Settlement isn't configured yet" };
  if (!(await claimResolutionForSettlement(resolutionId))) {
    return { resolutionId, status: resolution.settlementStatus, ran: false };
  }

  try {
    const result = await settle({
      resolutionId,
      marketId: resolution.marketId,
      outcome: resolution.outcome,
      resolvedAt: resolution.resolvedAt,
    });
    await completeResolutionSettlement(resolutionId, db, result?.settlementModelId);
    return { resolutionId, status: SettlementStatus.COMPLETED, ran: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[settlement] ${resolutionId} failed`, error);
    await failResolutionSettlement(resolutionId, message);
    return { resolutionId, status: SettlementStatus.FAILED, ran: true, error: message };
  }
}

/** Retries everything that still needs settling. Run from cron. */
export async function runPendingSettlements(settle: SettleFn | null = forecastingSettle, limit = 20) {
  if (!settle) return [];
  const due = await db.resolution.findMany({
    where: {
      OR: [
        { settlementStatus: { in: [SettlementStatus.PENDING, SettlementStatus.FAILED] } },
        { settlementStatus: SettlementStatus.IN_PROGRESS, settlementStartedAt: { lt: new Date(Date.now() - STALE_SETTLEMENT_MS) } },
      ],
    },
    orderBy: { resolvedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  const runs: SettlementRun[] = [];
  for (const { id } of due) runs.push(await runSettlement(id, settle));
  return runs;
}
