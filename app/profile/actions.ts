"use server";

import { refresh } from "next/cache";
import { toApiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { updateProfile } from "@/lib/users";
import { updateProfileSchema } from "@/lib/validation";

export interface ProfileFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<"displayName" | "username" | "bio", string>>;
  /** What was submitted, so a failed save keeps the user's input. */
  values?: { displayName: string; username: string; bio: string };
}

const HELP = {
  displayName: "Use 1 to 80 characters.",
  username: "Use 3 to 30 lowercase letters, numbers, or underscores.",
  bio: "Keep it under 500 characters.",
};

export async function updateProfileAction(_: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const field = (name: string) => {
    const value = fd.get(name);
    return typeof value === "string" ? value : "";
  };
  const values = { displayName: field("displayName"), username: field("username"), bio: field("bio") };
  const username = values.username.trim();
  const parsed = updateProfileSchema.safeParse({
    displayName: field("displayName"),
    username: username === "" ? null : username,
    bio: field("bio"),
  });
  if (!parsed.success) {
    const fieldErrors: ProfileFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof HELP;
      // Keep custom messages ("That username is reserved"), replace Zod's defaults.
      fieldErrors[key] = key === "username" && issue.code === "custom" ? issue.message : HELP[key];
    }
    return { ok: false, message: "Check the highlighted fields.", fieldErrors, values };
  }

  try {
    const user = await requireUser();
    await rateLimit(`profile:${user.id}`, RATE_LIMITS.profileUpdate);
    await updateProfile(user, parsed.data);
  } catch (error) {
    const apiError = toApiError(error);
    return apiError.status === 409
      ? { ok: false, message: null, fieldErrors: { username: apiError.message }, values }
      : { ok: false, message: apiError.message, values };
  }
  refresh();
  return { ok: true, message: "Profile saved." };
}
