/**
 * Wires VC services to the real adapters. Server-only.
 */
import { prisma } from "@/lib/db";
import type { VcDeps } from "../ports";
import { createVcServices, type VcServices } from "../services";
import { createForecastingGateway } from "./forecasting-adapter";
import { createPlatformGateway } from "./platform-adapter";
import { createPrismaVcRepository } from "./prisma-repository";

let deps: VcDeps | undefined;
let services: VcServices | undefined;

export function getVcDeps(): VcDeps {
  deps ??= {
    repo: createPrismaVcRepository(prisma),
    platform: createPlatformGateway(prisma),
    forecasting: createForecastingGateway(),
    now: () => new Date(),
  };
  return deps;
}

export function getVcServices(): VcServices {
  services ??= createVcServices(getVcDeps());
  return services;
}
