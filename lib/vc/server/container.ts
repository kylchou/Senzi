/**
 * Wires VC services to the real adapters. Server-only.
 */
import "server-only";
import { db } from "@/lib/db";
import type { VcDeps } from "../ports";
import { createVcServices, type VcServices } from "../services";
import { createForecastingGateway } from "./forecasting-adapter";
import { createPendingIndicatorGateway } from "./indicators-pending";
import { createPlatformGateway } from "./platform-adapter";
import { createPrismaVcRepository } from "./prisma-repository";

let deps: VcDeps | undefined;
let services: VcServices | undefined;

export function getVcDeps(): VcDeps {
  deps ??= {
    repo: createPrismaVcRepository(db),
    platform: createPlatformGateway(db),
    forecasting: createForecastingGateway(db),
    // Switch to createIndicatorGateway() (./indicators-adapter) once lib/model
    // can be bundled; see indicators-pending.ts.
    indicators: createPendingIndicatorGateway(),
    now: () => new Date(),
  };
  return deps;
}

export function getVcServices(): VcServices {
  services ??= createVcServices(getVcDeps(), {
    // What the team has approved sending to an AI provider; "standard" unless set.
    assistantTier: process.env.VC_ASSISTANT_DATA_TIER === "extended" ? "extended" : "standard",
  });
  return services;
}
