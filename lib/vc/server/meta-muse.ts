/**
 * INTEGRATION POINT (AI provider): Meta Model API, Muse Spark.
 *
 * OpenAI-compatible Chat Completions, called with fetch so no SDK dependency
 * is needed. Docs: https://dev.meta.ai/docs/protocols/chat-completions
 *
 * The API key is read from SENZI_AI_ASSISTANT_API_KEY (put it in .env.local
 * locally and in the Vercel project's environment variables; never in code).
 *
 * Uses the Standard-tier model, whose data Meta says is never used for
 * training. Don't switch to a "-contributor" model: those trade a lower price
 * for training on prompts, which would include private VC research.
 */
import { VcError } from "../errors";
import type { AssistantModel, ChatMessage, Completion, CompletionOptions } from "../assistant/model";

export const META_MODEL_API_URL = "https://api.meta.ai/v1/chat/completions";
export const DEFAULT_TYCHE_MODEL = "muse-spark-1.3";
/** Long enough for a reasoning model on a short answer, short enough to stay inside the route's 60s limit. */
const REQUEST_TIMEOUT_MS = 55_000;

export function tycheApiKey(): string | null {
  const key = process.env.SENZI_AI_ASSISTANT_API_KEY?.trim();
  return key ? key : null;
}

export function isTycheConfigured(): boolean {
  return tycheApiKey() !== null;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string; type?: string; code?: string };
}

export function createMetaMuseModel(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): AssistantModel {
  const model = options.model ?? DEFAULT_TYCHE_MODEL;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: model,
    async complete(messages: ChatMessage[], opts: CompletionOptions): Promise<Completion> {
      let res: Response;
      try {
        res = await doFetch(META_MODEL_API_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            // Muse Spark always reasons; "low" keeps chat answers quick.
            reasoning_effort: "low",
            // Muse Spark's hidden reasoning counts toward this limit, so leave room beyond the visible answer.
            max_completion_tokens: opts.maxTokens ?? 4000,
            safety_identifier: opts.userKey.slice(0, 64),
            ...(opts.cacheKey && { prompt_cache_key: opts.cacheKey }),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        console.error("[tyche] request to Meta Model API failed", err);
        throw new VcError("INTERNAL_ERROR", "Tyche couldn't reach its AI provider. Try again in a moment.");
      }

      const body = (await res.json().catch(() => null)) as ChatCompletionResponse | null;
      if (!res.ok) {
        console.error(`[tyche] Meta Model API ${res.status}`, body?.error ?? body);
        if (res.status === 429) throw new VcError("RATE_LIMITED", "Tyche is busy right now. Try again in a minute.");
        if (res.status === 401 || res.status === 403) {
          throw new VcError("INTERNAL_ERROR", "Tyche's API key was rejected. Ask an admin to check SENZI_AI_ASSISTANT_API_KEY.");
        }
        throw new VcError("INTERNAL_ERROR", "Tyche couldn't answer right now. Try again in a moment.");
      }

      const choice = body?.choices?.[0];
      const text = choice?.message?.content?.trim() ?? "";
      if (!text) throw new VcError("INTERNAL_ERROR", "Tyche returned an empty answer. Try rephrasing the question.");
      return { text, finishReason: choice?.finish_reason ?? null, model: body?.model ?? model };
    },
  };
}
