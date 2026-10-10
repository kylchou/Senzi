"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  adjustUserCredits,
  changeMarketStatus,
  createMarket,
  createStartup,
  resolveMarket,
  setPlatformRole,
  updateMarket,
  updateStartup,
} from "@/lib/admin";
import { toApiError } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/auth";
import type { SessionUser, ValidationIssue } from "@/lib/types";
import {
  adminCreditAdjustmentSchema,
  createMarketSchema,
  createStartupSchema,
  marketStatusChangeSchema,
  resolveMarketSchema,
  setPlatformRoleSchema,
  updateMarketSchema,
  updateStartupSchema,
} from "@/lib/validation";

export interface ActionState {
  ok: boolean;
  message: string | null;
  issues?: ValidationIssue[];
}

// --- FormData helpers --------------------------------------------------------

function text(fd: FormData, name: string): string | undefined {
  const value = fd.get(name);
  return typeof value === "string" ? value : undefined;
}

function number(fd: FormData, name: string): number | undefined {
  const value = text(fd, name)?.trim();
  return value ? Number(value) : undefined;
}

/** datetime-local inputs in the admin UI are UTC wall-clock values. */
function utcDate(fd: FormData, name: string): string | null | undefined {
  const value = text(fd, name)?.trim();
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value.length === 16 ? `${value}:00.000Z` : `${value}Z`;
}

function checkbox(fd: FormData, name: string): boolean {
  return fd.get(name) === "on";
}

function lines(fd: FormData, name: string): string[] {
  return (text(fd, name) ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Runs an admin mutation and turns failures into form state. */
async function run(work: (admin: SessionUser) => Promise<unknown>, success: string): Promise<ActionState> {
  try {
    const admin = await requirePlatformAdmin();
    await work(admin);
  } catch (error) {
    const apiError = toApiError(error);
    return {
      ok: false,
      message: apiError.message,
      issues: Array.isArray(apiError.details) ? apiError.details : undefined,
    };
  }
  refresh();
  return { ok: true, message: success };
}

// --- Startups -----------------------------------------------------------------

function startupFields(fd: FormData) {
  return {
    slug: text(fd, "slug"),
    name: text(fd, "name"),
    tagline: text(fd, "tagline"),
    description: text(fd, "description"),
    websiteUrl: text(fd, "websiteUrl"),
    logoUrl: text(fd, "logoUrl"),
    industry: text(fd, "industry"),
    stage: text(fd, "stage"),
    foundedYear: number(fd, "foundedYear") ?? null,
    headquarters: text(fd, "headquarters"),
    isPublished: checkbox(fd, "isPublished"),
  };
}

export async function createStartupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await run(async (admin) => {
    id = (await createStartup(admin, createStartupSchema.parse(startupFields(fd)))).id;
  }, "Startup created");
  if (state.ok) redirect(`/admin/startups/${id}`);
  return state;
}

export async function updateStartupAction(startupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) => updateStartup(admin, startupId, updateStartupSchema.parse(startupFields(fd))),
    "Startup saved",
  );
}

// --- Markets ------------------------------------------------------------------

/** "Title | https://url" per line. */
function sources(fd: FormData) {
  return lines(fd, "sources").map((line) => {
    const [title, url] = line.includes("|") ? line.split("|").map((part) => part.trim()) : [line, line];
    return { title, url };
  });
}

function marketFields(fd: FormData) {
  const visibility = text(fd, "visibility");
  const baselinePercent = number(fd, "openingBaselinePercent");
  // Locked (disabled) fields are not submitted; leave them out so they don't count as changes.
  return {
    slug: text(fd, "slug"),
    startupId: text(fd, "startupId"),
    question: text(fd, "question"),
    description: text(fd, "description"),
    yesCriteria: text(fd, "yesCriteria"),
    noCriteria: text(fd, "noCriteria"),
    category: text(fd, "category"),
    ...(fd.has("openingBaselinePercent")
      ? {
          openingBaseline: baselinePercent === undefined ? null : baselinePercent / 100,
          baselineMethodology: text(fd, "baselineMethodology"),
        }
      : {}),
    visibility,
    ...(fd.has("visibility")
      ? { organizationId: visibility === "PUBLIC" ? null : text(fd, "organizationId") || null }
      : {}),
    opensAt: utcDate(fd, "opensAt"),
    closesAt: utcDate(fd, "closesAt"),
    resolvesBy: utcDate(fd, "resolvesBy"),
    minForecastCredits: number(fd, "minForecastCredits") ?? null,
    maxForecastCredits: number(fd, "maxForecastCredits") ?? null,
    sources: sources(fd),
  };
}

export async function createMarketAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const state = await run(async (admin) => {
    const input = createMarketSchema.parse({ ...marketFields(fd), openImmediately: checkbox(fd, "openImmediately") });
    id = (await createMarket(admin, input)).id;
  }, "Market created");
  if (state.ok) redirect(`/admin/markets/${id}`);
  return state;
}

export async function updateMarketAction(marketId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) => updateMarket(admin, marketId, updateMarketSchema.parse(marketFields(fd))),
    "Market saved",
  );
}

export async function changeMarketStatusAction(marketId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      changeMarketStatus(
        admin,
        marketId,
        marketStatusChangeSchema.parse({ status: text(fd, "status"), reason: text(fd, "reason") }),
      ),
    "Status updated",
  );
}

export async function resolveMarketAction(marketId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      resolveMarket(
        admin,
        marketId,
        resolveMarketSchema.parse({
          outcome: text(fd, "outcome"),
          evidenceSummary: text(fd, "evidenceSummary"),
          evidenceUrls: lines(fd, "evidenceUrls"),
        }),
      ),
    "Resolution recorded. Settlement is pending.",
  );
}

// --- Users & credits ----------------------------------------------------------

export async function adjustCreditsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let replayed = false;
  const state = await run(async (admin) => {
    const input = adminCreditAdjustmentSchema.parse({
      userId: text(fd, "userId"),
      amount: number(fd, "amount"),
      type: text(fd, "type"),
      memo: text(fd, "memo"),
      idempotencyKey: text(fd, "idempotencyKey"),
    });
    replayed = (await adjustUserCredits(admin, input)).replayed;
  }, "Credits adjusted");
  if (state.ok && replayed) return { ok: true, message: "Already applied (duplicate submission ignored)" };
  return state;
}

export async function setPlatformRoleAction(userId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      setPlatformRole(admin, userId, setPlatformRoleSchema.parse({ platformRole: text(fd, "platformRole") }).platformRole),
    "Role updated",
  );
}
