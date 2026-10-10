"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  adjustUserCredits,
  changeMarketStatus,
  createMarket,
  createStartup,
  setAccountType,
  setPlatformRole,
  updateMarket,
  updateStartup,
} from "@/lib/admin";
import {
  createNewsItem,
  createStartupFact,
  deleteNewsItem,
  deleteStartupFact,
  updateNewsItem,
  updateStartupFact,
} from "@/lib/admin-content";
import { toApiError } from "@/lib/api-response";
import {
  approveProposal,
  proposeCorrection,
  proposeResolution,
  rejectProposal,
  retrySettlement,
} from "@/lib/resolutions";
import { requirePlatformAdmin } from "@/lib/auth";
import { reviewVcVerification } from "@/lib/verification";
import type { SessionUser, ValidationIssue } from "@/lib/types";
import {
  adminCreditAdjustmentSchema,
  createMarketSchema,
  createStartupSchema,
  marketStatusChangeSchema,
  newsItemSchema,
  approveProposalSchema,
  proposeCorrectionSchema,
  proposeResolutionSchema,
  rejectProposalSchema,
  startupFactSchema,
  reviewVerificationSchema,
  setAccountTypeSchema,
  setPlatformRoleSchema,
  updateMarketSchema,
  updateNewsItemSchema,
  updateStartupFactSchema,
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
    ...(fd.has("minForecastCredits") ? { minForecastCredits: number(fd, "minForecastCredits") ?? null } : {}),
    ...(fd.has("maxForecastCredits") ? { maxForecastCredits: number(fd, "maxForecastCredits") ?? null } : {}),
    ...(fd.has("sources") ? { sources: sources(fd) } : {}),
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

// --- Resolutions (two-admin approval) -----------------------------------------------

/** Evidence lines are "Title | https://url"; type and license apply to all of them. */
function proposalFields(fd: FormData) {
  const sourceType = text(fd, "sourceType") || "OTHER";
  const license = text(fd, "license") || "LINK_ONLY";
  return {
    outcome: text(fd, "outcome"),
    voidReason: text(fd, "outcome") === "VOID" ? text(fd, "voidReason") || null : null,
    evidenceSummary: text(fd, "evidenceSummary"),
    evidence: lines(fd, "evidence").map((line) => {
      const [title, url] = line.includes("|") ? line.split("|").map((part) => part.trim()) : [line, line];
      return { title, url, sourceType, license };
    }),
  };
}

export async function proposeResolutionAction(marketId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) => proposeResolution(admin, marketId, proposeResolutionSchema.parse(proposalFields(fd))),
    "Proposal submitted. Another admin needs to approve it.",
  );
}

export async function proposeCorrectionAction(resolutionId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      proposeCorrection(
        admin,
        resolutionId,
        proposeCorrectionSchema.parse({ ...proposalFields(fd), correctionReason: text(fd, "correctionReason") }),
      ),
    "Correction submitted. Another admin needs to approve it.",
  );
}

export async function approveProposalAction(proposalId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let settlementNote = "";
  const state = await run(async (admin) => {
    const { settlement } = await approveProposal(admin, proposalId, approveProposalSchema.parse({ note: text(fd, "note") }));
    settlementNote = settlement.ran ? ` Settlement: ${settlement.status}.` : settlement.error ? ` ${settlement.error}; it will run later.` : "";
  }, "Approved.");
  return state.ok ? { ...state, message: `Approved.${settlementNote}` } : state;
}

export async function rejectProposalAction(proposalId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) => rejectProposal(admin, proposalId, rejectProposalSchema.parse({ reason: text(fd, "reason") }).reason),
    "Proposal rejected",
  );
}

export async function retrySettlementAction(resolutionId: string): Promise<ActionState> {
  let message = "";
  const state = await run(async (admin) => {
    const result = await retrySettlement(admin, resolutionId);
    message = result.ran ? `Settlement ${result.status.toLowerCase()}${result.error ? `: ${result.error}` : ""}` : result.error ?? "Nothing to do";
  }, "Done");
  return state.ok ? { ...state, message } : state;
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

export async function setAccountTypeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      setAccountType(
        admin,
        text(fd, "userId")?.trim() ?? "",
        setAccountTypeSchema.parse({ accountType: text(fd, "accountType"), reason: text(fd, "reason") }),
      ),
    "Account type updated",
  );
}

export async function reviewVerificationAction(requestId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      reviewVcVerification(admin, requestId, reviewVerificationSchema.parse({ decision: text(fd, "decision"), note: text(fd, "note") })),
    "Decision saved",
  );
}

// --- Startup facts --------------------------------------------------------------

export async function createFactAction(startupId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      createStartupFact(
        admin,
        startupId,
        startupFactSchema.parse({
          label: text(fd, "label"),
          value: text(fd, "value"),
          sourceName: text(fd, "sourceName"),
          sourceUrl: text(fd, "sourceUrl"),
          asOf: utcDate(fd, "asOf"),
          sourceType: text(fd, "sourceType") || undefined,
          license: text(fd, "license") || undefined,
          verified: checkbox(fd, "verified"),
        }),
      ),
    "Fact added",
  );
}

export async function setFactVerifiedAction(factId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const verified = text(fd, "verified") === "true";
  return run(
    (admin) => updateStartupFact(admin, factId, updateStartupFactSchema.parse({ verified })),
    verified ? "Marked verified" : "Marked unverified",
  );
}

export async function deleteFactAction(factId: string): Promise<ActionState> {
  return run((admin) => deleteStartupFact(admin, factId), "Fact deleted");
}

// --- News -----------------------------------------------------------------------

function newsFields(fd: FormData) {
  return {
    startupId: text(fd, "startupId") || null,
    title: text(fd, "title"),
    summary: text(fd, "summary"),
    publisher: text(fd, "publisher"),
    url: text(fd, "url"),
    publishedAt: utcDate(fd, "publishedAt"),
    verification: text(fd, "verification"),
    license: text(fd, "license") || undefined,
  };
}

export async function createNewsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run((admin) => createNewsItem(admin, newsItemSchema.parse(newsFields(fd))), "News item added");
}

export async function updateNewsAction(newsId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run((admin) => updateNewsItem(admin, newsId, updateNewsItemSchema.parse(newsFields(fd))), "News item saved");
}

export async function setNewsVerificationAction(newsId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(
    (admin) =>
      updateNewsItem(admin, newsId, updateNewsItemSchema.parse({ verification: text(fd, "verification") })),
    "Verification updated",
  );
}

export async function deleteNewsAction(newsId: string): Promise<ActionState> {
  return run((admin) => deleteNewsItem(admin, newsId), "News item deleted");
}
