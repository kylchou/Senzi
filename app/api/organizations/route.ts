import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { createOrganization, listMyOrganizations } from "@/lib/organizations";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createOrganizationSchema } from "@/lib/validation";

/** Organizations the caller belongs to, with their role in each. */
export const GET = withApiHandler(async () => {
  const user = await requireUser();
  return ok(await listMyOrganizations(user));
});

/** Creates an organization; the caller becomes its OWNER. */
export const POST = withApiHandler(async (req) => {
  const user = await requireUser();
  await rateLimit(`org-create:${user.id}`, RATE_LIMITS.orgCreate);
  const input = await parseJsonBody(req, createOrganizationSchema);
  return created(await createOrganization(user, input, { ip: clientIp(req) }));
});
