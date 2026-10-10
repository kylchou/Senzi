/**
 * INTEGRATION POINT (baseline model and forecasting engine).
 *
 * Turns a study's measurable question into an opening line with the model in
 * lib/model (computeDirectBaseline: same-metric trend forecasting), and later
 * publishes newer estimates to the market's model line through the
 * forecasting engine's recordModelValue, the only path that moves it.
 *
 * Public history comes from the model's data files (as for indicators). The
 * firm's own figures come from the study and are never written anywhere other
 * firms can read: market tables only get publicInputs().
 */
import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { BaselineStatus } from "@/generated/prisma/enums";
import { db, isUniqueViolation } from "@/lib/db";
import { withEngine } from "@/lib/forecasting/server/service";
import { FileModelStore, type ModelStore } from "@/lib/model";
import { estimateWithModel, modelMetricsFor } from "../model-estimate";
import { inputsNoteFor, publicInputs } from "../opening-line";
import type { ModelGateway } from "../ports";

/** The engine accepts model values only from these service ids (lib/forecasting/server/service.ts). */
const MODEL_SERVICE = { kind: "service" as const, serviceId: "model-service" };

export function createModelGateway(store: ModelStore = new FileModelStore()): ModelGateway {
  return {
    metricsFor(startup) {
      return modelMetricsFor(store, startup);
    },

    async estimate(input) {
      return estimateWithModel(store, input);
    },

    async publishUpdate(marketId, estimate) {
      if (estimate.status !== "OK" || estimate.probability == null || !estimate.inputsHash) return false;
      const exists = await db.modelBaselineSnapshot.findUnique({
        where: { marketId_inputsHash: { marketId, inputsHash: estimate.inputsHash } },
        select: { id: true },
      });
      if (exists) return false;
      try {
        await withEngine(async (engine, tx) => {
          await engine.recordModelValue(MODEL_SERVICE, marketId, {
            value: estimate.probability!,
            asOf: estimate.asOf,
            modelVersion: estimate.modelVersion,
            inputsNote: inputsNoteFor(estimate, estimate.link?.metricId ?? "model"),
          });
          await tx.modelBaselineSnapshot.create({
            data: {
              marketId,
              status: BaselineStatus.OK,
              probability: estimate.probability,
              low: estimate.low,
              high: estimate.high,
              confidence: estimate.confidence,
              asOf: estimate.asOf,
              modelName: estimate.modelName,
              modelVersion: estimate.modelVersion,
              inputsHash: estimate.inputsHash!,
              method: { source: "study-model-refresh" },
              inputsUsed: publicInputs(estimate.inputsUsed) as Prisma.InputJsonValue,
              sources: [],
              missing: [],
              notes: estimate.notes,
            },
          });
        });
      } catch (err) {
        // Two refreshes raced: the other one already published this estimate.
        if (isUniqueViolation(err)) return false;
        throw err;
      }
      return true;
    },
  };
}
