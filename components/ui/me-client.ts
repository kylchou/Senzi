"use client";

/** The signed-in user from GET /api/users/me (Kyler's API), fetched once per page load. */
export interface Me {
  displayName: string;
  creditBalance: number;
  memberships: unknown[];
  /** "VC" accounts sponsor questions and never trade. */
  accountType: "VC" | "TRADER" | null;
}

let request: Promise<Me | null> | null = null;

export function getMe(): Promise<Me | null> {
  request ??= fetch("/api/users/me", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { data?: Me } | null) => body?.data ?? null)
    .catch(() => null);
  return request;
}

/** Forget the cached user, for example after a forecast changes the balance. */
export function refreshMe() {
  request = null;
}
