import "server-only";

// The forecasting engine's settle function for Ky's settlement state machine
// (lib/settlement.ts). Ky's code claims the resolution and records success or
// failure; this pays every forecast once.
//
// LMSR: winners get 1 credit per share (rounded down to whole credits), losers
// get nothing because their credits already bought shares. VOID refunds what
// each trader spent. Everything runs in one transaction and every ledger write
// uses a deterministic idempotency key, so a retry never pays twice.

import { ForecastStatus } from "@/generated/prisma/enums";
import { createCreditLedger } from "@/lib/credit-ledger";
import { db } from "@/lib/db";
import type { SettleFn } from "@/lib/settlement";
import { buildSnapshot, nextSnapshotSequence } from "../history";
import { createLmsrRule, createLmsrSettlement, LMSR_SETTLEMENT_ID } from "../lmsr-pricing";
import { applyPayouts, planPayouts, VOID_REFUND_MODEL_ID } from "../settlement";
import { PrismaForecastRepository } from "./prisma-repository";
import { MARKET_MAKER_ACCOUNT_ID } from "./service";

export const forecastingSettle: SettleFn = async ({ marketId, outcome }) => {
  return db.$transaction(
    async (tx) => {
      // Lock the market so no forecast lands mid-settlement.
      await tx.$executeRaw`SELECT "id" FROM "Market" WHERE "id" = ${marketId} FOR UPDATE`;
      const repo = new PrismaForecastRepository(tx);
      const market = await repo.getMarket(marketId);
      if (!market) throw new Error(`Market ${marketId} not found`);
      const forecasts = await repo.listForecastsByMarket(marketId);

      const missing = forecasts.filter((f) => outcome !== "VOID" && typeof f.fill?.shares !== "number");
      if (missing.length) {
        throw new Error(
          `${missing.length} forecast(s) on this market have no LMSR shares (placed before LMSR pricing), so they can't be paid per share. Reseed or settle them separately.`,
        );
      }

      const plan = planPayouts({ settlementModel: createLmsrSettlement() }, market, outcome, forecasts);
      await applyPayouts(createCreditLedger(tx), {
        marketId,
        outcome,
        payouts: plan.payouts,
        ...(MARKET_MAKER_ACCOUNT_ID ? { marketMakerAccountId: MARKET_MAKER_ACCOUNT_ID } : {}),
      });

      const now = new Date();
      for (const p of plan.payouts) {
        await tx.forecast.update({
          where: { id: p.forecastId },
          data: {
            status: outcome === "VOID" ? ForecastStatus.REFUNDED : ForecastStatus.SETTLED,
            payout: p.payout,
            settledAt: now,
          },
        });
      }

      const snapshots = await repo.listSnapshots(marketId);
      if (!snapshots.some((s) => s.trigger === "settlement")) {
        await repo.appendSnapshot(
          buildSnapshot({
            market,
            forecasts,
            rule: createLmsrRule(),
            trigger: "settlement",
            at: now,
            sequence: await nextSnapshotSequence(repo, marketId),
          }),
        );
      }
      return { settlementModelId: outcome === "VOID" ? VOID_REFUND_MODEL_ID : LMSR_SETTLEMENT_ID };
    },
    { timeout: 60_000 },
  );
};
