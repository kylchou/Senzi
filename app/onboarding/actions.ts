"use server";

import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { toApiError } from "@/lib/api-response";
import { chooseAccountType, homePathFor, parseAccountType, requireUser } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { bypassVcVerification, submitVcVerification, switchToTrader } from "@/lib/verification";
import { vcVerificationSchema } from "@/lib/validation";

export async function chooseAccountTypeAction(fd: FormData) {
  const type = parseAccountType(fd.get("accountType"));
  if (!type) redirect("/onboarding");
  const user = await chooseAccountType(await requireUser(), type);
  redirect(homePathFor(user));
}

export interface VerificationFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Partial<Record<"firmName" | "firmWebsite" | "jobTitle" | "workEmail" | "linkedinUrl" | "note", string>>;
}

const HELP = {
  firmName: "Enter your firm's name.",
  firmWebsite: "Enter the firm's website, starting with https://",
  jobTitle: "Enter your role at the firm.",
  workEmail: "Enter a valid work email.",
  linkedinUrl: "Enter a full LinkedIn URL, or leave it blank.",
  note: "Keep it under 1,000 characters.",
};

export async function submitVerificationAction(_: VerificationFormState, fd: FormData): Promise<VerificationFormState> {
  const field = (name: string) => {
    const value = fd.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = vcVerificationSchema.safeParse({
    firmName: field("firmName"),
    firmWebsite: field("firmWebsite").trim(),
    jobTitle: field("jobTitle"),
    workEmail: field("workEmail"),
    linkedinUrl: field("linkedinUrl").trim(),
    note: field("note"),
  });
  if (!parsed.success) {
    const fieldErrors: VerificationFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof typeof HELP;
      fieldErrors[key] = HELP[key];
    }
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  try {
    const user = await requireUser();
    await rateLimit(`verification:${user.id}`, RATE_LIMITS.verificationSubmit);
    await submitVcVerification(user, parsed.data);
  } catch (error) {
    return { ok: false, message: toApiError(error).message };
  }
  redirect("/onboarding");
}

/** Demo only: a code from DEMO_VC_BYPASS_CODE skips the admin review. Disabled when the variable is unset. */
export async function bypassVerificationAction(fd: FormData) {
  const expected = process.env.DEMO_VC_BYPASS_CODE;
  const code = fd.get("code");
  const user = await requireUser();
  await rateLimit(`verification:${user.id}`, RATE_LIMITS.verificationSubmit);
  const a = Buffer.from(typeof code === "string" ? code : "");
  const b = Buffer.from(expected ?? "");
  if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) redirect("/onboarding?bypass=invalid");
  await bypassVcVerification(user);
  redirect("/onboarding");
}

export async function switchToTraderAction() {
  const user = await requireUser();
  await switchToTrader(user);
  redirect("/profile");
}
