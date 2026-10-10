import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getCurrentUserProfile, updateProfile } from "@/lib/users";
import { updateProfileSchema } from "@/lib/validation";

/** The signed-in user's profile, credit balance, and org memberships. */
export const GET = withApiHandler(async () => {
  const user = await requireUser();
  return ok(await getCurrentUserProfile(user));
});

export const PATCH = withApiHandler(async (req) => {
  const user = await requireUser();
  const input = await parseJsonBody(req, updateProfileSchema);
  return ok(await updateProfile(user, input));
});
