import { z } from "zod";
import {
  CreditTransactionType,
  ForecastSide,
  MarketStatus,
  MarketVisibility,
  OrgRole,
  PlatformRole,
  ResolutionOutcome,
  StartupStage,
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
    website: optionalUrl,
    logoUrl: optionalUrl,
    sector: z.string().trim().min(1).max(80),
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

const marketFields = {
  slug: slugSchema,
  startupId: idSchema,
  question: z
    .string()
    .trim()
    .min(10)
    .max(300)
    .refine((q) => q.endsWith("?"), "Phrase the market as a YES/NO question ending in '?'"),
  description: optionalText(5000),
  resolutionCriteria: z.string().trim().min(20, "Describe measurable YES/NO criteria").max(5000),
  resolutionSource: optionalText(1000),
  category: optionalText(80),
  openingBaseline: openingBaselineSchema,
  visibility: z.enum(MarketVisibility).default(MarketVisibility.PUBLIC),
  organizationId: idSchema.nullish(),
  opensAt: dateInputSchema,
  closesAt: dateInputSchema,
  resolvesBy: dateInputSchema.nullish(),
};

type MarketDates = {
  visibility?: MarketVisibility;
  organizationId?: string | null;
  opensAt?: Date;
  closesAt?: Date;
  resolvesBy?: Date | null;
};

function checkMarketInvariants(value: MarketDates, ctx: z.RefinementCtx) {
  if (value.opensAt && value.closesAt && value.closesAt <= value.opensAt) {
    ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Deadline must be after the open time" });
  }
  if (value.closesAt && value.resolvesBy && value.resolvesBy < value.closesAt) {
    ctx.addIssue({ code: "custom", path: ["resolvesBy"], message: "Resolution date cannot precede the deadline" });
  }
  if (value.visibility === MarketVisibility.PRIVATE && !value.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Private markets need an organization" });
  }
  if (value.visibility && value.visibility !== MarketVisibility.PRIVATE && value.organizationId) {
    ctx.addIssue({ code: "custom", path: ["organizationId"], message: "Only private markets belong to an organization" });
  }
}

export const createMarketSchema = z
  .object({ ...marketFields, openImmediately: z.boolean().default(false) })
  .strict()
  .superRefine(checkMarketInvariants);

/** Cross-field rules are re-checked against the merged record in lib/admin.ts. */
export const updateMarketSchema = z.object(marketFields).partial().strict();

export const marketStatusChangeSchema = z
  .object({
    status: z.enum([MarketStatus.OPEN, MarketStatus.CLOSED, MarketStatus.CANCELLED]),
    reason: optionalText(1000),
  })
  .strict();

export const resolveMarketSchema = z
  .object({
    outcome: z.enum(ResolutionOutcome),
    evidenceSummary: z.string().trim().min(20, "Explain how the evidence meets the criteria").max(5000),
    evidenceUrls: z.array(httpUrlSchema).min(1, "Cite at least one source").max(10),
  })
  .strict();

export { checkMarketInvariants };

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
export type AdminCreditAdjustmentInput = z.output<typeof adminCreditAdjustmentSchema>;
export type ForecastSubmissionInput = z.output<typeof forecastSubmissionSchema>;
