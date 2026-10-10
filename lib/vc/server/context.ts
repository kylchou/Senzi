import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { ACTIVE_ORG_COOKIE } from "../constants";
import { VcError } from "../errors";
import type { OrgMembership, VcContext } from "../types";
import { getVcDeps } from "./container";
import { joinDemoOrgIfNew } from "./demo-org";

/** Picks the requested org if the user belongs to it, else their first membership. */
export function resolveActiveOrg(
  memberships: OrgMembership[],
  preferredOrgId: string | null | undefined,
): OrgMembership | null {
  return memberships.find((m) => m.organizationId === preferredOrgId) ?? memberships[0] ?? null;
}

/**
 * Builds the VC context for the current request from the shared auth session.
 * Memoized per request. Returns null when signed out.
 */
export const getVcContext = cache(async (requestedOrgId?: string | null): Promise<VcContext | null> => {
  const { platform } = getVcDeps();
  const user = await platform.getSessionUser();
  if (!user) return null;
  let memberships = await platform.getMemberships(user.id);
  if (memberships.length === 0 && (await joinDemoOrgIfNew(user.id))) memberships = await platform.getMemberships(user.id);
  const cookieOrg = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return { user, memberships, activeOrg: resolveActiveOrg(memberships, requestedOrgId ?? cookieOrg) };
});

export async function requireVcContext(requestedOrgId?: string | null): Promise<VcContext> {
  const ctx = await getVcContext(requestedOrgId);
  if (!ctx) throw new VcError("UNAUTHENTICATED", "Sign in to access Senzi Intelligence");
  return ctx;
}
