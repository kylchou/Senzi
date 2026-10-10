/**
 * The one interface Tyche needs from an AI provider. The Meta Model API
 * implementation lives in lib/vc/server/meta-muse.ts; tests use fakes.
 */

export interface ChatMessage {
  /** "developer" carries Tyche's standing instructions and the evidence. */
  role: "developer" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  /** Stable, non-identifying key for the asking user (a hash), for provider abuse detection. */
  userKey: string;
  /** Groups requests about the same subject so the provider can reuse its prompt cache. */
  cacheKey?: string;
  maxTokens?: number;
}

export interface Completion {
  text: string;
  /** "stop", "length", … as reported by the provider; null if not given. */
  finishReason: string | null;
  model: string;
}

export interface AssistantModel {
  /** Model id, shown in audit logs. */
  readonly name: string;
  complete(messages: ChatMessage[], options: CompletionOptions): Promise<Completion>;
}
