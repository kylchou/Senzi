import { ACTIVE_ORG_COOKIE } from "@/lib/vc/constants";
import { notFound } from "@/lib/vc/errors";
import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { activeOrgInput } from "@/lib/vc/validation";

/**
 * GET /api/vc/active-org — the caller's workspaces, for the header's Intelligence menu:
 * { memberships: [{ organizationId, organizationName, role }], activeOrgId, isPlatformAdmin }.
 */
export const GET = withVc(async ({ ctx }) =>
  ok({
    memberships: ctx.memberships.map(({ organizationId, organizationName, role }) => ({ organizationId, organizationName, role })),
    activeOrgId: ctx.activeOrg?.organizationId ?? null,
    isPlatformAdmin: ctx.user.isPlatformAdmin,
  }),
);

/** POST /api/vc/active-org — { organizationId } switches the active workspace. */
export const POST = withVc(async ({ req, ctx }) => {
  const { organizationId } = await parseBody(req, activeOrgInput);
  const membership = ctx.memberships.find((m) => m.organizationId === organizationId);
  if (!membership) throw notFound("Organization");
  const res = ok(membership);
  res.cookies.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
});
