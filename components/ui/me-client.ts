"use client";

/** The signed-in user from GET /api/users/me (Kyler's API), fetched once per user per page load. */
export interface Me {
  displayName: string;
  creditBalance: number;
  memberships: unknown[];
  /** "VC" accounts sponsor questions and never trade. */
  accountType: "VC" | "TRADER" | null;
}

let request: Promise<Me | null> | null = null;
let requestKey: string | null | undefined;

/**
 * Cached per signed-in user (pass Clerk's userId). Failed responses and users
 * who haven't picked an account type yet aren't cached, so signing in or
 * finishing onboarding without a full reload still picks up the account type.
 */
export function getMe(userId?: string | null): Promise<Me | null> {
  if (userId !== undefined && userId !== requestKey) request = null;
  if (userId !== undefined) requestKey = userId;
  const pending = (request ??= fetch("/api/users/me", { credentials: "same-origin", cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { data?: Me } | null) => body?.data ?? null)
    .catch(() => null));
  pending.then((me) => {
    if ((!me || !me.accountType) && request === pending) request = null;
  });
  return pending;
}

/** Forget the cached user, for example after a forecast changes the balance. */
export function refreshMe() {
  request = null;
}
