import { z } from "zod";
import { MAX_PARTICIPANTS, MAX_SOURCES } from "./constants";
import { ALERT_TYPES, STUDY_STATUSES, STUDY_VISIBILITIES } from "./types";

const id = z.string().trim().min(1).max(64);
const httpUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), "Only http(s) links are allowed");

export const studySourceInput = z.object({
  url: httpUrl,
  title: z.string().trim().min(1).max(300),
  publisher: z.string().trim().max(200).nullish(),
  publishedAt: z.coerce.date().nullish(),
});
export type StudySourceInput = z.infer<typeof studySourceInput>;

const studyFields = {
  startupId: id,
  question: z
    .string()
    .trim()
    .min(15, "Question must be at least 15 characters")
    .max(300)
    .refine((q) => q.endsWith("?"), "Phrase the question as a YES/NO question ending with '?'"),
  yesCriteria: z.string().trim().min(10, "Describe what counts as YES").max(2000),
  noCriteria: z.string().trim().min(10, "Describe what counts as NO").max(2000),
  context: z.string().trim().max(5000).nullish(),
  baselineValue: z.number().min(0.01).max(0.99).nullish(),
  baselineMethodology: z.string().trim().min(20).max(3000).nullish(),
  deadline: z.coerce.date(),
  visibility: z.enum(STUDY_VISIBILITIES),
  sources: z.array(studySourceInput).max(MAX_SOURCES).optional(),
};
const studyObject = z.object(studyFields);

export const createStudyInput = studyObject.refine(
  (v) => (v.baselineValue == null) === (v.baselineMethodology == null),
  { message: "Provide the baseline value and its methodology together", path: ["baselineMethodology"] },
);
export type CreateStudyInput = z.infer<typeof createStudyInput>;

/** Partial edit of a DRAFT study. Omitted fields are left unchanged. */
export const updateStudyInput = studyObject.partial().extend({
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
    emails: z.array(z.string().trim().toLowerCase().email()).max(MAX_PARTICIPANTS).default([]),
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

export const createWatchlistInput = z.object({ name: z.string().trim().min(1).max(80) });

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
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
