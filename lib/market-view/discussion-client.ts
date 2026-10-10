import type { CommentView, DiscussionPage } from "./discussion-types";

/** Browser calls for market discussion threads (app/api/markets/[slug]/comments). */

export class DiscussionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  RATE_LIMITED: "You're posting quickly. Try again in a minute.",
  UNAUTHENTICATED: "Sign in to join the discussion.",
  NETWORK: "Couldn't reach Senzi. Check your connection and try again.",
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new DiscussionError("NETWORK", FRIENDLY.NETWORK!);
  }
  const body = (await response.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !body || body.data === undefined) {
    const code = body?.error?.code ?? "UNKNOWN";
    throw new DiscussionError(code, FRIENDLY[code] ?? body?.error?.message ?? "Something went wrong. Try again.");
  }
  return body.data;
}

const base = (slug: string) => `/api/markets/${encodeURIComponent(slug)}/comments`;

export function fetchDiscussion(slug: string, cursor?: string): Promise<DiscussionPage> {
  return request(cursor ? `${base(slug)}?cursor=${encodeURIComponent(cursor)}` : base(slug), { cache: "no-store" });
}

export function postComment(slug: string, body: string, parentId?: string): Promise<CommentView> {
  return request(base(slug), { method: "POST", body: JSON.stringify(parentId ? { body, parentId } : { body }) });
}

export function deleteComment(slug: string, commentId: string): Promise<{ id: string }> {
  return request(`${base(slug)}/${encodeURIComponent(commentId)}`, { method: "DELETE" });
}
