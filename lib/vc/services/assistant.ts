import { createHash } from "node:crypto";
import { checkCitations, splitSentenceParts } from "../assistant/citations";
import type { AssistantModel } from "../assistant/model";
import { buildMessages, repairMessage, type ChatTurn } from "../assistant/prompt";
import { renderContext } from "../assistant/render";
import type { CitationIssue, CitationReport, ContextPackage, ContextScope, OmittedEvidence } from "../assistant/types";
import { VcError } from "../errors";
import type { VcContext } from "../types";
import type { AssistantContextService } from "./assistant-context";

export interface AskInput {
  scope: ContextScope;
  question: string;
  history: ChatTurn[];
}

export interface AskResult {
  /** The checked answer, sentence by sentence, with clickable citations. */
  answer: CitationReport;
  /** The model's raw text (with [[id]] markers), sent back as history on the next turn. */
  raw: string;
  /** What the conversation is about, e.g. the study question. */
  subject: string;
  /** Evidence that was left out of the package, and why. */
  omitted: OmittedEvidence[];
  /** Whether the first answer failed the citation check and was rewritten. */
  repaired: boolean;
  model: string;
  generatedAt: string;
}

function subjectOf(pkg: ContextPackage): string {
  if (pkg.scope.kind === "study") {
    const questionId = `study:${pkg.scope.studyId}#question`;
    return pkg.items.find((i) => i.id === questionId)?.value ?? "This study";
  }
  const names = pkg.items.filter((i) => i.kind === "startup").map((i) => i.label);
  return names.length ? `Comparing ${names.join(", ")}` : "This comparison";
}

function failures(raw: string, report: CitationReport): { sentence: string; issue: CitationIssue }[] {
  const parts = splitSentenceParts(raw);
  return report.sentences.flatMap((s, i) =>
    s.issues.filter((issue) => issue.severity === "error").map((issue) => ({ sentence: parts[i]?.text ?? s.text, issue })),
  );
}

/**
 * Tyche: answers a question about one study or comparison using only the
 * authorized evidence package, then checks every citation before anything is
 * returned. An answer that fails the check gets one automatic rewrite.
 */
export function createAssistantService(
  services: { assistantContext: AssistantContextService },
  model: AssistantModel | null,
) {
  async function ask(ctx: VcContext, input: AskInput): Promise<AskResult> {
    if (!model) {
      throw new VcError("INVALID_STATE", "Tyche isn't set up yet. An admin needs to add SENZI_AI_ASSISTANT_API_KEY.");
    }
    const pkg =
      input.scope.kind === "study"
        ? await services.assistantContext.forStudy(ctx, input.scope.studyId)
        : await services.assistantContext.forComparison(ctx, input.scope.startupIds);

    const evidence = renderContext(pkg);
    const messages = buildMessages(evidence, input.history, input.question);
    const options = {
      userKey: createHash("sha256").update(`senzi-tyche:${ctx.user.id}`).digest("hex"),
      cacheKey: `tyche:${input.scope.kind === "study" ? input.scope.studyId : input.scope.startupIds.join(",")}`,
    };

    let completion = await model.complete(messages, options);
    let report = checkCitations(completion.text, pkg);
    let repaired = false;

    if (report.errorCount > 0) {
      const retry = await model.complete(
        [...messages, { role: "assistant", content: completion.text }, repairMessage(failures(completion.text, report))],
        options,
      );
      const retryReport = checkCitations(retry.text, pkg);
      if (retryReport.errorCount < report.errorCount) {
        completion = retry;
        report = retryReport;
        repaired = true;
      }
    }

    return {
      answer: report,
      raw: completion.text,
      subject: subjectOf(pkg),
      omitted: pkg.omitted,
      repaired,
      model: completion.model,
      generatedAt: new Date().toISOString(),
    };
  }

  return { enabled: model !== null, ask };
}

export type AssistantService = ReturnType<typeof createAssistantService>;
