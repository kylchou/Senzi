import { z } from "zod";
import { httpUrlSchema, idSchema } from "@/lib/validation";
import { MAX_PARTICIPANTS, MAX_PRIZE_POOL_CREDITS, MAX_SOURCES } from "./constants";
import { ALERT_TYPES, STUDY_STATUSES, STUDY_VISIBILITIES } from "./types";

/*
 * Limits match lib/validation.ts createMarketForStudySchema, so any study that
 * passes review can always open its market.
 */
const id = idSchema;

export const studySourceInput = z.object({
  url: httpUrlSchema,
  title: z.string().trim().min(1).max(200),
  publisher: z.string().trim().max(200).nullish(),
  publishedAt: z.coerce.date().nullish(),
});
export type StudySourceInput = z.infer<typeof studySourceInput>;

/** A real calendar day, YYYY-MM-DD (UTC). */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Enter a real calendar date");

const metricLinkFields = {
  metricId: z.string().trim().min(1).max(200),
  threshold: z.number().finite().positive("Threshold must be more than 0").max(1e15),
  targetDate: day,
};

/**
 * The measurable form of a study question that the model prices. The firm's
 * own figures come from its company page, never from this payload. Null
 * means no metric measures the question, so the model has no opening line.
 */
export const modelLinkInput = z.object(metricLinkFields);
export type ModelLinkInput = z.infer<typeof modelLinkInput>;

const studyFields = {
  startupId: id,
  question: z
    .string()
    .trim()
    .min(15, "Question must be at least 15 characters")
    .max(300)
    .refine((q) => q.endsWith("?"), "Phrase the question as a YES/NO question ending with '?'"),
  yesCriteria: z.string().trim().min(20, "Describe exactly what counts as YES").max(5000),
  noCriteria: z.string().trim().min(20, "Describe exactly what counts as NO").max(5000),
  context: z.string().trim().max(5000).nullish(),
  /** The opening line comes from the model, never from the firm: link the question to a metric instead. */
  modelLink: modelLinkInput.nullish(),
  deadline: z.coerce.date(),
  /** Legacy and API use only; the form sets the audiences below and the visibility follows from them. */
  visibility: z.enum(STUDY_VISIBILITIES).optional(),
  /** Any retail trader may trade. */
  openToPublic: z.boolean().default(true),
  /** Only traders verified as users of the startup's product may trade and see the line. */
  openToVerified: z.boolean().default(false),
  /** Credits split among traders by what they gained once the market settles. */
  prizePoolCredits: z.number().int("Whole credits only").min(0).max(MAX_PRIZE_POOL_CREDITS).default(0),
  sources: z.array(studySourceInput).max(MAX_SOURCES).optional(),
};
const studyObject = z.object(studyFields);

const AUDIENCE_REQUIRED = { message: "Open the question to the public, to verified users, or both", path: ["openToPublic"] };

export const createStudyInput = studyObject.refine((v) => v.openToPublic || v.openToVerified, AUDIENCE_REQUIRED);
type ParsedCreateStudy = z.output<typeof createStudyInput>;
/** What callers send; the audience and prize default to public, not verified-only, no prize. */
export type CreateStudyInput = Omit<ParsedCreateStudy, "openToPublic" | "openToVerified" | "prizePoolCredits"> &
  Partial<Pick<ParsedCreateStudy, "openToPublic" | "openToVerified" | "prizePoolCredits">>;

/** Partial edit of a DRAFT study. Omitted fields are left unchanged. */
export const updateStudyInput = studyObject.partial().extend({
  openToPublic: z.boolean().optional(),
  openToVerified: z.boolean().optional(),
  prizePoolCredits: z.number().int("Whole credits only").min(0).max(MAX_PRIZE_POOL_CREDITS).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdateStudyInput = z.infer<typeof updateStudyInput>;

export const STUDY_ACTIONS = [
  "submit",
  "withdraw",
  "approve",
  "reject",
  "revise",
  "open",
  "close",
  "cancel",
] as const;
/** `resolve` is system-only (driven by market resolution) and not accepted from clients. */
export type ClientStudyAction = (typeof STUDY_ACTIONS)[number];

export const transitionInput = z.object({
  action: z.enum(STUDY_ACTIONS),
  reason: z.string().trim().min(3).max(2000).optional(),
  expectedVersion: z.number().int().positive(),
});
export type TransitionInput = z.infer<typeof transitionInput>;

export const participantsInput = z
  .object({
    userIds: z.array(id).max(MAX_PARTICIPANTS).default([]),
    emails: z.array(z.string().trim().toLowerCase().pipe(z.email())).max(MAX_PARTICIPANTS).default([]),
  })
  .refine((v) => v.userIds.length + v.emails.length <= MAX_PARTICIPANTS, {
    message: `At most ${MAX_PARTICIPANTS} participants`,
  });
export type ParticipantsInput = z.infer<typeof participantsInput>;

export const noteInput = z.object({ body: z.string().trim().min(1).max(10000) });

export const studyListQuery = z.object({
  scope: z.enum(["organization", "public", "participating"]).default("organization"),
  status: z.enum(STUDY_STATUSES).optional(),
});

export const watchlistItemInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STARTUP"), startupId: id }),
  z.object({ type: z.literal("STUDY"), studyId: id }),
]);
export type WatchlistItemInput = z.infer<typeof watchlistItemInput>;

export const alertListQuery = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  type: z.enum(ALERT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const markAlertsReadInput = z.object({
  alertIds: z.array(id).min(1).max(200),
});

export const reportFormat = z.enum(["json", "markdown", "csv"]).default("json");

export const saveReportInput = z.object({
  studyId: id,
  title: z.string().trim().min(1).max(200).optional(),
});

export const activeOrgInput = z.object({ organizationId: id });

export const startupSearchQuery = z.object({
  q: z.string().trim().min(1).max(100),
});

/** Formats Zod issues into a flat, client-friendly shape. */
export function formatIssues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

// ---------------------------------------------------------------------------
// Tyche (AI research assistant)
// ---------------------------------------------------------------------------

export const assistantAskInput = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("study"), studyId: id }),
    z.object({ kind: z.literal("comparison"), startupIds: z.array(id).min(2).max(4) }),
  ]),
  question: z.string().trim().min(1, "Ask a question").max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20)
    .default([]),
});
export type AssistantAskInput = z.infer<typeof assistantAskInput>;

/** Preview of the model's opening line while drafting; nothing is saved. */
export const openingLinePreviewInput = z.object({
  startupId: id,
  question: z.string().trim().min(5, "Type the question first").max(300),
  deadline: z.coerce.date(),
  /** Omit to have the AI suggest a measurable form of the question. */
  link: z.object(metricLinkFields).nullish(),
});
export type OpeningLinePreviewInput = z.infer<typeof openingLinePreviewInput>;
