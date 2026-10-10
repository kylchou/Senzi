import { z } from "zod";
import {
  AccountType,
  CreditTransactionType,
  ForecastSide,
  MarketStatus,
  MarketVisibility,
  NewsVerification,
  OrgRole,
  PlatformRole,
  ResolutionOutcome,
  SourceLicense,
  SourceType,
  StartupStage,
  StudyVisibility,
  VoidReason,
} from "@/generated/prisma/enums";
import { MAX_CREDIT_TRANSACTION, RESERVED_USERNAMES } from "@/lib/types";

/**
 * Shared Zod schemas. Every API route and server action validates input with
 * one of these before touching the database.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const idSchema = z.string().trim().min(1).max(64);

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens");

/** http(s) URLs only — rejects javascript:, data:, etc. */
export const httpUrlSchema = z
  .url({ protocol: /^https?$/, hostname: z.regexes.domain })
  .max(2048);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullish();

const optionalUrl = z
  .union([z.literal(""), httpUrlSchema])
  .transform((value) => (value === "" ? null : value))
  .nullish();

/** Accepts a Date or an ISO-8601 string with an offset ("2026-10-09T12:00:00Z"). */
export const dateInputSchema = z.union([
  z.date(),
  z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
]);

/** Probability of YES as a fraction in [0, 1]. */
export const probabilitySchema = z.number().min(0).max(1);

/** Opening baselines must leave room on both sides: [0.01, 0.99]. */
export const openingBaselineSchema = z.number().min(0.01).max(0.99);

export const creditAmountSchema = z
  .number()
  .int("Credits are whole numbers")
  .positive()
  .max(MAX_CREDIT_TRANSACTION);

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9:_.-]+$/, "Only letters, numbers, and : _ . - are allowed");

export const paginationSchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores")
  .refine((name) => !(RESERVED_USERNAMES as readonly string[]).includes(name), "That username is reserved");

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    username: usernameSchema.nullable(),
    bio: optionalText(500),
    avatarUrl: optionalUrl,
  })
  .partial()
  .strict();

export const setPlatformRoleSchema = z.object({ platformRole: z.enum(PlatformRole) }).strict();

export const setAccountTypeSchema = z
  .object({ accountType: z.enum(AccountType), reason: z.string().trim().min(3).max(500) })
  .strict();

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const createOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: slugSchema,
    description: optionalText(1000),
    website: optionalUrl,
  })
  .strict();

export const updateOrganizationSchema = createOrganizationSchema.partial().strict();

export const addMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    role: z.enum(OrgRole).default(OrgRole.VIEWER),
  })
  .strict();

export const updateMemberRoleSchema = z.object({ role: z.enum(OrgRole) }).strict();

// ---------------------------------------------------------------------------
// Admin: startups
// ---------------------------------------------------------------------------

export const createStartupSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(120),
    tagline: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    websiteUrl: optionalUrl,
    logoUrl: optionalUrl,
    industry: z.string().trim().min(1).max(80),
    stage: z.enum(StartupStage),
    foundedYear: z.number().int().min(1900).max(2100).nullish(),
    headquarters: optionalText(120),
    isPublished: z.boolean().default(false),
  })
  .strict();

export const updateStartupSchema = createStartupSchema
  .omit({ isPublished: true })
  .extend({ isPublished: z.boolean() })
  .partial()
  .strict();

// ---------------------------------------------------------------------------
// Admin: markets
// ---------------------------------------------------------------------------

const questionSchema = z
  .string()
  .trim()
  .min(10)
  .max(300)
  .refine((q) => q.endsWith("?"), "Phrase the market as a YES/NO question ending in '?'");

const criteriaSchema = (side: "YES" | "NO") =>
  z.string().trim().min(20, `Describe exactly what makes this resolve ${side}`).max(5000);

/** Provenance shared by sources, facts, news, and evidence. */
const provenanceFields = {
  sourceType: z.enum(SourceType).default(SourceType.OTHER),
  /** A public page isn't automatically licensed for reuse, so default to link-only. */
  license: z.enum(SourceLicense).default(SourceLicense.LINK_ONLY),
  /** When we read the source. Defaults to now. */
  retrievedAt: dateInputSchema.optional(),
};

/** Where the resolver will look for evidence. */
export const marketSourceSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: httpUrlSchema,
    publisher: optionalText(120),
    publishedAt: dateInputSchema.nullish(),
    ...provenanceFields,
  })
  .strict();

const marketFields = {
  slug: slugSchema,
  startupId: idSchema,
  question: questionSchema,
  description: optionalText(5000),
  yesCriteria: criteriaSchema("YES"),
  noCriteria: criteriaSchema("NO"),
  category: optionalText(80),
  /** Optional: the model service can supply it later. Requires a methodology when set. */
  openingBaseline: openingBaselineSchema.nullish(),
  baselineMethodology: optionalText(1000),
  visibility: z.enum(MarketVisibility).default(MarketVisibility.PUBLIC),
  organizationId: idSchema.nullish(),
  opensAt: dateInputSchema,
  closesAt: dateInputSchema,
  resolvesBy: dateInputSchema.nullish(),
  minForecastCredits: creditAmountSchema.nullish(),
  maxForecastCredits: creditAmountSchema.nullish(),
  sources: z.array(marketSourceSchema).min(1, "Add at least one resolution source").max(10),
};

type MarketDates = {
  visibility?: MarketVisibility;
  organizationId?: string | null;
  opensAt?: Date;
  closesAt?: Date;
  resolvesBy?: Date | null;
  openingBaseline?: number | null;
  baselineMethodology?: string | null;
  minForecastCredits?: number | null;
  maxForecastCredits?: number | null;
};

function checkMarketInvariants(value: MarketDates, ctx: z.RefinementCtx) {
  if (value.opensAt && value.closesAt && value.closesAt <= value.opensAt) {
    ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Deadline must be after the open time" });
  }
  if (value.closesAt && value.resolvesBy && value.resolvesBy < value.closesAt) {
    ctx.addIssue({ code: "custom", path: ["resolvesBy"], message: "Resolution date cannot precede the deadline" });
  }
  if (value.visibility && value.visibility !== MarketVisibility.PUBLIC && !value.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Organization and restricted markets need an organization" });
  }
  if (value.visibility === MarketVisibility.PUBLIC && value.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Public markets don't belong to an organization" });
  }
  if (value.openingBaseline != null && !value.baselineMethodology) {
    ctx.addIssue({ code: "custom", path: ["baselineMethodology"], message: "Explain how the opening baseline was derived" });
  }
  if (value.minForecastCredits != null && value.maxForecastCredits != null && value.maxForecastCredits < value.minForecastCredits) {
    ctx.addIssue({ code: "custom", path: ["maxForecastCredits"], message: "Maximum must be at least the minimum" });
  }
}

export const createMarketSchema = z
  .object({ ...marketFields, openImmediately: z.boolean().default(false) })
  .strict()
  .superRefine(checkMarketInvariants);

/**
 * Cross-field rules are re-checked against the merged record in lib/admin.ts.
 * Passing `sources` replaces the whole list.
 */
export const updateMarketSchema = z.object(marketFields).partial().strict();

/**
 * Input from VC Intelligence when a reviewed study opens (lib/admin.ts
 * createMarketForStudy). Idempotent on studyId.
 */
export const createMarketForStudySchema = z
  .object({
    studyId: idSchema,
    organizationId: idSchema,
    startupId: idSchema,
    question: questionSchema,
    yesCriteria: criteriaSchema("YES"),
    noCriteria: criteriaSchema("NO"),
    closesAt: dateInputSchema,
    openingBaseline: z.object({ value: openingBaselineSchema, methodology: z.string().trim().min(3).max(1000) }),
    visibility: z.enum(StudyVisibility),
    sources: z.array(z.object({ url: httpUrlSchema, title: z.string().trim().min(1).max(200) })).max(20),
    createdById: idSchema,
  })
  .strict();

export const marketStatusChangeSchema = z
  .object({
    status: z.enum([MarketStatus.OPEN, MarketStatus.CLOSED, MarketStatus.CANCELLED]),
    reason: optionalText(1000),
  })
  .strict();

function checkVoidReason(value: { outcome?: ResolutionOutcome; voidReason?: VoidReason | null }, ctx: z.RefinementCtx) {
  if (value.outcome === ResolutionOutcome.VOID && !value.voidReason) {
    ctx.addIssue({ code: "custom", path: ["voidReason"], message: "Say why the market is void" });
  }
  if (value.outcome !== ResolutionOutcome.VOID && value.voidReason) {
    ctx.addIssue({ code: "custom", path: ["voidReason"], message: "Only VOID outcomes have a void reason" });
  }
}

const evidenceSummarySchema = z.string().trim().min(20, "Explain how the evidence meets the criteria").max(5000);

/** One piece of resolution evidence, with where it came from. */
export const evidenceItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: httpUrlSchema,
    publisher: optionalText(120),
    publishedAt: dateInputSchema.nullish(),
    note: optionalText(1000),
    ...provenanceFields,
  })
  .strict();

const proposalFields = {
  outcome: z.enum(ResolutionOutcome),
  voidReason: z.enum(VoidReason).nullish(),
  evidenceSummary: evidenceSummarySchema,
  evidence: z.array(evidenceItemSchema).min(1, "Cite at least one source").max(10),
};

/** An admin proposes an outcome; a different admin approves it. */
export const proposeResolutionSchema = z.object(proposalFields).strict().superRefine(checkVoidReason);

/** A proposed change to an approved resolution. Needs its own approval. */
export const proposeCorrectionSchema = z
  .object({ ...proposalFields, correctionReason: z.string().trim().min(10, "Explain what was wrong").max(2000) })
  .strict()
  .superRefine(checkVoidReason);

export const approveProposalSchema = z.object({ note: optionalText(1000) }).strict();

export const rejectProposalSchema = z
  .object({ reason: z.string().trim().min(3, "Say why it's rejected").max(1000) })
  .strict();

export const proposalQuerySchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED", "REJECTED"]).optional(),
  marketId: idSchema.optional(),
});

/**
 * Shortcut used by tests and scripts: propose and approve in one call with
 * plain evidence links. Approval still follows the two-admin rule.
 */
export const resolveMarketSchema = z
  .object({
    outcome: z.enum(ResolutionOutcome),
    voidReason: z.enum(VoidReason).nullish(),
    evidenceSummary: evidenceSummarySchema,
    evidenceUrls: z.array(httpUrlSchema).min(1, "Cite at least one source").max(10),
  })
  .strict()
  .superRefine(checkVoidReason);

export { checkMarketInvariants };

// ---------------------------------------------------------------------------
// Admin: startup facts and news
// ---------------------------------------------------------------------------

/** A sourced fact shown on a startup page. `verified` = an admin checked the source. */
export const startupFactSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.string().trim().min(1).max(200),
    sourceName: z.string().trim().min(1).max(120),
    sourceUrl: httpUrlSchema,
    asOf: dateInputSchema,
    verified: z.boolean().default(false),
    ...provenanceFields,
  })
  .strict();

export const updateStartupFactSchema = startupFactSchema
  .omit({ verified: true })
  .extend({ verified: z.boolean() })
  .partial()
  .strict();

export const newsItemSchema = z
  .object({
    startupId: idSchema.nullish(),
    marketId: idSchema.nullish(),
    title: z.string().trim().min(3).max(300),
    summary: optionalText(2000),
    publisher: z.string().trim().min(1).max(120),
    url: httpUrlSchema,
    publishedAt: dateInputSchema,
    verification: z.enum(NewsVerification).default(NewsVerification.UNVERIFIED),
    license: provenanceFields.license,
    retrievedAt: provenanceFields.retrievedAt,
  })
  .strict();

export const updateNewsItemSchema = newsItemSchema
  .omit({ verification: true })
  .extend({ verification: z.enum(NewsVerification) })
  .partial()
  .strict();

export const newsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  startupId: idSchema.optional(),
  verification: z.enum(NewsVerification).optional(),
});

// ---------------------------------------------------------------------------
// Admin: credits
// ---------------------------------------------------------------------------

export const adminCreditAdjustmentSchema = z
  .object({
    userId: idSchema,
    amount: z
      .number()
      .int("Credits are whole numbers")
      .refine((n) => n !== 0, "Amount cannot be zero")
      .refine((n) => Math.abs(n) <= MAX_CREDIT_TRANSACTION, `At most ${MAX_CREDIT_TRANSACTION} per adjustment`),
    type: z.enum([CreditTransactionType.ADMIN_GRANT, CreditTransactionType.ADMIN_ADJUSTMENT]),
    memo: z.string().trim().min(3, "Explain the adjustment").max(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine((v) => v.type !== CreditTransactionType.ADMIN_GRANT || v.amount > 0, {
    path: ["amount"],
    message: "Grants must be positive; use an adjustment to debit",
  });

export const auditLogQuerySchema = paginationSchema.extend({
  entityType: z.string().trim().max(64).optional(),
  entityId: idSchema.optional(),
  actorId: idSchema.optional(),
  action: z.string().trim().max(64).optional(),
});

// ---------------------------------------------------------------------------
// Forecasting contract (consumed by Engineer 2's submission endpoint)
// ---------------------------------------------------------------------------

export const forecastSubmissionSchema = z
  .object({
    marketId: idSchema,
    side: z.enum(ForecastSide),
    credits: creditAmountSchema,
    statedProbability: probabilitySchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export type UpdateProfileInput = z.output<typeof updateProfileSchema>;
export type CreateOrganizationInput = z.output<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.output<typeof updateOrganizationSchema>;
export type AddMemberInput = z.output<typeof addMemberSchema>;
export type CreateStartupInput = z.output<typeof createStartupSchema>;
export type UpdateStartupInput = z.output<typeof updateStartupSchema>;
export type CreateMarketInput = z.output<typeof createMarketSchema>;
export type UpdateMarketInput = z.output<typeof updateMarketSchema>;
export type MarketStatusChangeInput = z.output<typeof marketStatusChangeSchema>;
export type ResolveMarketInput = z.output<typeof resolveMarketSchema>;
export type ProposeResolutionInput = z.output<typeof proposeResolutionSchema>;
export type ProposeCorrectionInput = z.output<typeof proposeCorrectionSchema>;
export type EvidenceItemInput = z.output<typeof evidenceItemSchema>;
export type AdminCreditAdjustmentInput = z.output<typeof adminCreditAdjustmentSchema>;
export type ForecastSubmissionInput = z.output<typeof forecastSubmissionSchema>;
export type CreateMarketForStudyInput = z.input<typeof createMarketForStudySchema>;
export type StartupFactInput = z.output<typeof startupFactSchema>;
export type UpdateStartupFactInput = z.output<typeof updateStartupFactSchema>;
export type NewsItemInput = z.output<typeof newsItemSchema>;
export type UpdateNewsItemInput = z.output<typeof updateNewsItemSchema>;
export type MarketSourceInput = z.output<typeof marketSourceSchema>;
