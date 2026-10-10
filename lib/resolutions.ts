import type { Prisma, Resolution } from "@/generated/prisma/client";
import {
  MarketStatus,
  NotificationType,
  ProposalStatus,
  ResolutionOutcome,
  SettlementStatus,
} from "@/generated/prisma/enums";
import { assertAdmin } from "@/lib/admin-guard";
import { conflict, forbidden, invalidState, notFound } from "@/lib/api-response";
import { diffChanges, recordAudit } from "@/lib/audit";
import { db, isUniqueViolation, type TxClient } from "@/lib/db";
import { runSettlement, type SettlementRun } from "@/lib/settlement";
import type { RequestContext, SessionUser } from "@/lib/types";
import type {
  EvidenceItemInput,
  ProposeCorrectionInput,
  ProposeResolutionInput,
  ResolveMarketInput,
} from "@/lib/validation";

/**
 * Market resolution with two-admin approval.
 *
 *   propose (admin A) -> approve (admin B) -> Resolution + settlement
 *                     -> reject (any admin, including A to withdraw)
 *
 * Proposals and their evidence are never edited or deleted (database
 * triggers), so the full decision history of a market is preserved.
 * Corrections go through the same propose/approve flow.
 *
 * VOID covers cancelled, ambiguous, unverifiable, and mis-specified markets
 * (see VoidReason); every stake is refunded. The market becomes CANCELLED.
 */

/** Self-approval is for local development and tests only. */
export function selfApprovalAllowed() {
  return process.env.SENZI_ALLOW_SELF_APPROVAL === "true" && process.env.NODE_ENV !== "production";
}

const marketStatusFor = (outcome: ResolutionOutcome) =>
  outcome === ResolutionOutcome.VOID ? MarketStatus.CANCELLED : MarketStatus.RESOLVED;

async function lockMarket(tx: TxClient, marketId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Market" WHERE "id" = ${marketId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Market");
  return tx.market.findUniqueOrThrow({ where: { id: marketId } });
}

function evidenceRows(evidence: EvidenceItemInput[], submittedById: string) {
  return evidence.map((item) => ({ ...item, submittedById }));
}

async function createProposal(
  tx: TxClient,
  actor: SessionUser,
  marketId: string,
  input: ProposeResolutionInput & { correctionReason?: string; correctsId?: string },
) {
  return tx.resolutionProposal.create({
    data: {
      marketId,
      correctsId: input.correctsId ?? null,
      outcome: input.outcome,
      voidReason: input.voidReason ?? null,
      evidenceSummary: input.evidenceSummary,
      correctionReason: input.correctionReason ?? null,
      proposedById: actor.id,
      evidence: { create: evidenceRows(input.evidence, actor.id) },
    },
    include: { evidence: true },
  });
}

/**
 * Proposes the outcome of an OPEN or CLOSED market. Closes the market so
 * forecasting stops while the proposal is reviewed. One open proposal at a time.
 */
export async function proposeResolution(
  actor: SessionUser,
  marketId: string,
  input: ProposeResolutionInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const market = await lockMarket(tx, marketId);
    if (market.status !== MarketStatus.OPEN && market.status !== MarketStatus.CLOSED) {
      throw invalidState(`Only open or closed markets can be resolved (this one is ${market.status})`);
    }
    const pending = await tx.resolutionProposal.findFirst({
      where: { marketId, status: ProposalStatus.PROPOSED },
      select: { id: true },
    });
    if (pending) throw conflict("This market already has a proposal waiting for review");

    if (market.status === MarketStatus.OPEN) {
      await tx.market.update({ where: { id: marketId }, data: { status: MarketStatus.CLOSED } });
    }
    const proposal = await createProposal(tx, actor, marketId, input);
    await recordAudit(
      {
        actorId: actor.id,
        organizationId: market.organizationId,
        action: "resolution.propose",
        entityType: "ResolutionProposal",
        entityId: proposal.id,
        data: { marketId, outcome: input.outcome, voidReason: input.voidReason ?? null, evidence: input.evidence.map((e) => e.url) },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return proposal;
  });
}

/**
 * Proposes a change to an approved resolution. Takes effect only when a
 * second admin approves it. Changing the outcome is only possible before any
 * credits have moved (settlement PENDING or FAILED).
 */
export async function proposeCorrection(
  actor: SessionUser,
  resolutionId: string,
  input: ProposeCorrectionInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const resolution = await tx.resolution.findUnique({ where: { id: resolutionId } });
    if (!resolution) throw notFound("Resolution");
    const market = await lockMarket(tx, resolution.marketId);
    assertOutcomeChangeAllowed(resolution, input.outcome);
    const pending = await tx.resolutionProposal.findFirst({
      where: { marketId: market.id, status: ProposalStatus.PROPOSED },
      select: { id: true },
    });
    if (pending) throw conflict("This market already has a proposal waiting for review");

    const proposal = await createProposal(tx, actor, market.id, { ...input, correctsId: resolutionId });
    await recordAudit(
      {
        actorId: actor.id,
        organizationId: market.organizationId,
        action: "resolution.proposeCorrection",
        entityType: "ResolutionProposal",
        entityId: proposal.id,
        data: { resolutionId, from: resolution.outcome, to: input.outcome, reason: input.correctionReason },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return proposal;
  });
}

function assertOutcomeChangeAllowed(resolution: Resolution, outcome: ResolutionOutcome) {
  if (outcome === resolution.outcome) return;
  if (resolution.settlementStatus === SettlementStatus.IN_PROGRESS) {
    throw conflict("Settlement is running; try the correction again in a moment");
  }
  if (resolution.settlementStatus === SettlementStatus.COMPLETED) {
    throw invalidState(
      "Credits have already been settled, so the outcome can't change without reversing payouts. Evidence-only corrections are still allowed.",
    );
  }
}

/**
 * Approves a proposal (must be a different admin than the proposer). Creates
 * or corrects the market's Resolution, then runs settlement. Settlement
 * failures don't undo the approval; they leave the resolution FAILED for retry.
 */
export async function approveProposal(
  actor: SessionUser,
  proposalId: string,
  opts: { note?: string | null } = {},
  ctx: RequestContext = {},
): Promise<{ resolution: Resolution; settlement: SettlementRun }> {
  assertAdmin(actor);
  let resolution: Resolution;
  try {
    resolution = await db.$transaction(async (tx) => {
      const proposal = await tx.resolutionProposal.findUnique({ where: { id: proposalId }, include: { evidence: true } });
      if (!proposal) throw notFound("Proposal");
      if (proposal.proposedById === actor.id && !selfApprovalAllowed()) {
        throw forbidden("A different admin has to approve this proposal");
      }
      const market = await lockMarket(tx, proposal.marketId);

      const { count } = await tx.resolutionProposal.updateMany({
        where: { id: proposalId, status: ProposalStatus.PROPOSED },
        data: { status: ProposalStatus.APPROVED, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: opts.note ?? null },
      });
      if (count === 0) throw conflict("This proposal has already been reviewed");

      const fields = {
        outcome: proposal.outcome,
        voidReason: proposal.voidReason,
        evidenceSummary: proposal.evidenceSummary,
        evidenceUrls: proposal.evidence.map((e) => e.url),
        currentProposalId: proposal.id,
      };
      const newStatus = marketStatusFor(proposal.outcome);
      let result: Resolution;

      if (proposal.correctsId) {
        const before = await tx.resolution.findUniqueOrThrow({ where: { id: proposal.correctsId } });
        assertOutcomeChangeAllowed(before, proposal.outcome);
        result = await tx.resolution.update({
          where: { id: before.id },
          data: { ...fields, correctionCount: { increment: 1 } },
        });
        if (market.status !== newStatus) {
          await tx.market.update({ where: { id: market.id }, data: { status: newStatus } });
        }
        await recordAudit(
          {
            actorId: actor.id,
            organizationId: market.organizationId,
            action: "resolution.correct",
            entityType: "Resolution",
            entityId: before.id,
            data: {
              proposalId,
              proposedById: proposal.proposedById,
              reason: proposal.correctionReason,
              changes: diffChanges(before, { outcome: fields.outcome, voidReason: fields.voidReason, evidenceSummary: fields.evidenceSummary, evidenceUrls: fields.evidenceUrls }),
            } as Prisma.InputJsonValue,
            ipAddress: ctx.ip,
          },
          tx,
        );
      } else {
        if (market.status !== MarketStatus.OPEN && market.status !== MarketStatus.CLOSED) {
          throw invalidState(`Market is already ${market.status}`);
        }
        result = await tx.resolution.create({
          data: {
            ...fields,
            marketId: market.id,
            resolvedById: proposal.proposedById,
            approvedById: actor.id,
            approvedAt: new Date(),
            settlementStatus: SettlementStatus.PENDING,
          },
        });
        await tx.market.update({ where: { id: market.id }, data: { status: newStatus } });
        await recordAudit(
          {
            actorId: actor.id,
            organizationId: market.organizationId,
            action: "market.resolve",
            entityType: "Market",
            entityId: market.id,
            data: {
              resolutionId: result.id,
              proposalId,
              proposedById: proposal.proposedById,
              outcome: proposal.outcome,
              voidReason: proposal.voidReason,
              evidenceUrls: fields.evidenceUrls,
              previousStatus: market.status,
            },
            ipAddress: ctx.ip,
          },
          tx,
        );
      }

      const forecasters = await tx.forecast.findMany({
        where: { marketId: market.id },
        distinct: ["userId"],
        select: { userId: true },
      });
      if (forecasters.length > 0) {
        const verb = proposal.correctsId ? "corrected" : proposal.outcome === ResolutionOutcome.VOID ? "voided" : `resolved ${proposal.outcome}`;
        await tx.notification.createMany({
          data: forecasters.map(({ userId }) => ({
            userId,
            type: NotificationType.MARKET_RESOLVED,
            title: `Market ${verb}: ${market.question}`,
            link: `/markets/${market.slug}`,
            data: { marketId: market.id, resolutionId: result.id, outcome: proposal.outcome },
          })),
        });
      }
      return result;
    });
  } catch (error) {
    if (isUniqueViolation(error, "marketId")) throw conflict("This market has already been resolved");
    throw error;
  }

  const settlement = await runSettlement(resolution.id);
  return { resolution, settlement };
}

/** Rejects a proposal. The proposer may also use this to withdraw it. */
export async function rejectProposal(
  actor: SessionUser,
  proposalId: string,
  reason: string,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const proposal = await tx.resolutionProposal.findUnique({ where: { id: proposalId } });
    if (!proposal) throw notFound("Proposal");
    const { count } = await tx.resolutionProposal.updateMany({
      where: { id: proposalId, status: ProposalStatus.PROPOSED },
      data: { status: ProposalStatus.REJECTED, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: reason },
    });
    if (count === 0) throw conflict("This proposal has already been reviewed");
    await recordAudit(
      {
        actorId: actor.id,
        action: proposal.proposedById === actor.id ? "resolution.withdraw" : "resolution.reject",
        entityType: "ResolutionProposal",
        entityId: proposalId,
        data: { marketId: proposal.marketId, reason },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return tx.resolutionProposal.findUniqueOrThrow({ where: { id: proposalId } });
  });
}

export async function listResolutionProposals(
  actor: SessionUser,
  opts: { status?: ProposalStatus; marketId?: string } = {},
) {
  assertAdmin(actor);
  return db.resolutionProposal.findMany({
    where: { status: opts.status, marketId: opts.marketId },
    orderBy: { proposedAt: "desc" },
    take: 200,
    include: {
      evidence: { orderBy: { createdAt: "asc" } },
      proposedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
      market: { select: { id: true, slug: true, question: true, status: true } },
    },
  });
}

/** Admin retry button / cron: settle an approved resolution now. */
export async function retrySettlement(actor: SessionUser, resolutionId: string, ctx: RequestContext = {}) {
  assertAdmin(actor);
  const run = await runSettlement(resolutionId);
  await recordAudit({
    actorId: actor.id,
    action: "resolution.settle",
    entityType: "Resolution",
    entityId: resolutionId,
    data: { ...run },
    ipAddress: ctx.ip,
  });
  return run;
}

/**
 * Shortcut for tests, scripts, and seeds: propose with plain evidence links
 * and approve in one call. Still follows the two-admin rule, so pass a
 * different `approver` unless self-approval is enabled for development.
 */
export async function resolveMarket(
  proposer: SessionUser,
  marketId: string,
  input: ResolveMarketInput,
  ctx: RequestContext = {},
  opts: { approver?: SessionUser } = {},
): Promise<Resolution> {
  const proposal = await proposeResolution(
    proposer,
    marketId,
    {
      outcome: input.outcome,
      voidReason: input.voidReason ?? null,
      evidenceSummary: input.evidenceSummary,
      evidence: input.evidenceUrls.map((url) => ({ title: url, url, sourceType: "OTHER", license: "LINK_ONLY" })),
    },
    ctx,
  );
  const { resolution } = await approveProposal(opts.approver ?? proposer, proposal.id, {}, ctx);
  return resolution;
}
