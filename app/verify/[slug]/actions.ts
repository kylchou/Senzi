"use server";

import { redirect } from "next/navigation";
import { toApiError } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { redeemAccessCode, SCREENSHOT_MAX_BYTES, submitScreenshot } from "@/lib/product-verification";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { redeemAccessCodeSchema } from "@/lib/validation";

export interface VerifyFormState {
  ok: boolean;
  message: string | null;
}

/** Bound arguments come back from the browser, so only same-site paths are allowed. */
function safePath(path: string, fallback: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : fallback;
}

export async function redeemCodeAction(
  startupId: string,
  returnTo: string,
  _: VerifyFormState,
  fd: FormData,
): Promise<VerifyFormState> {
  const parsed = redeemAccessCodeSchema.safeParse({ code: fd.get("code") });
  if (!parsed.success) return { ok: false, message: "Enter the code you were given." };
  try {
    const user = await requireUser();
    await rateLimit(`access-code:${user.id}`, RATE_LIMITS.accessCodeRedeem);
    await redeemAccessCode(user, startupId, parsed.data.code);
  } catch (error) {
    return { ok: false, message: toApiError(error).message };
  }
  redirect(safePath(returnTo, "/"));
}

export async function submitScreenshotAction(
  startupId: string,
  returnTo: string,
  _: VerifyFormState,
  fd: FormData,
): Promise<VerifyFormState> {
  const file = fd.get("screenshot");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a screenshot to upload." };
  if (file.size > SCREENSHOT_MAX_BYTES) return { ok: false, message: "Screenshots can be up to 3 MB." };
  const note = fd.get("note");
  try {
    const user = await requireUser();
    await rateLimit(`product-screenshot:${user.id}`, RATE_LIMITS.verificationSubmit);
    await submitScreenshot(user, startupId, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 1000) : null,
    });
  } catch (error) {
    return { ok: false, message: toApiError(error).message };
  }
  redirect(safePath(returnTo, "/"));
}
