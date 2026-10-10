/** Browser-side helper for calling the VC API. Never computes authoritative data. */
export class VcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function vcFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined && { "Content-Type": "application/json" }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = payload?.error;
    throw new VcApiError(
      res.status,
      err?.code ?? "UNKNOWN",
      res.status === 401 ? "Your session has expired. Please sign in again." : err?.message ?? "Request failed",
      err?.details,
    );
  }
  return payload?.data as T;
}

/** Turns validation details into a field → message map for forms. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof VcApiError) || !Array.isArray(err.details)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details as { path?: string; message?: string }[]) {
    if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
  }
  return out;
}
