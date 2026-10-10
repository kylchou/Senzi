import "server-only";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isVcError } from "../errors";
import type { VcContext } from "../types";
import { getVcContext } from "./context";

/**
 * For VC pages: sends signed-out visitors to sign in (the same pattern as
 * requireAdminPage in lib/auth.ts) and returns the VC context.
 */
export async function requirePageContext(returnTo: string): Promise<VcContext> {
  const ctx = await getVcContext();
  if (!ctx) {
    const { redirectToSignIn } = await auth();
    return redirectToSignIn({ returnBackUrl: returnTo });
  }
  return ctx;
}

/** Maps hidden/missing resources to the 404 page; rethrows everything else. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (isVcError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
